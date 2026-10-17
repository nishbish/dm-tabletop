import * as crypto from 'node:crypto';
import * as http from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { builtInHandlers } from './handlers';
import { createLogger } from './logger';
import { Connection, Handler, HandlerContext, Room } from './room';
import { createEmptyState, migrate } from './state';
import { isValidRoomId } from './storage/roomId';
import {
  Args,
  AuthenticateFn,
  AuthResult,
  JoinEvent,
  LeaveEvent,
  Logger,
  RoomStorage,
} from './types';
import { HandlerError, optionalEcho } from './validate';

export interface TabletopServerOptions {
  storage: RoomStorage;
  // Decides who may join which room. Default: anyone (see README).
  authenticate?: AuthenticateFn;
  // Wait this long after the last change before saving a room.
  saveDebounceMs?: number;
  // Upper bound on how long continuous changes can postpone a save (default 10x the debounce).
  maxSaveDelayMs?: number;
  port?: number;
  host?: string;
  logger?: Logger;
  // Extra event names (asset libraries, room lists, ...) supplied by the hosting app.
  handlers?: { [name: string]: Handler };
  // Lifecycle callbacks for the hosting app (presence, usage stats...). onJoin runs after a
  // connection joined (the `joined` message is already sent), onLeave after a joined connection
  // closed. They run one after another for the same user and room, in the order the events
  // happened, are never awaited by the server's message handling, and an error (or a rejected
  // promise) is logged and otherwise ignored. stop() waits for those still running.
  onJoin?: (event: JoinEvent) => void | Promise<void>;
  onLeave?: (event: LeaveEvent) => void | Promise<void>;
}

// Close code sent to connections of a room removed with discardRoom().
export const ROOM_DISCARDED_CLOSE_CODE = 4404;

export interface TabletopServer {
  // Starts listening; resolves with the actual port (useful when port is 0).
  start(): Promise<number>;
  stop(): Promise<void>;
  httpServer: http.Server;
  rooms: Map<string, Room>;
  // Completes a websocket handshake for a request that arrived on the host app's own http server:
  //   appServer.on('upgrade', (req, socket, head) => { if (req.url is ours) tabletop.handleUpgrade(req, socket, head); });
  // The path is not checked here; the host decides which requests are ours.
  handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void;
  // Sends `message` (any JSON object, usually {type:"update", name, args}) to every connection of
  // the given users in ANY loaded room, e.g. to tell members who are in another room. `filter`
  // narrows it down. Returns how many connections it was sent to.
  sendToUsers(
    userIds: string[],
    message: object,
    filter?: (connection: Connection, room: Room) => boolean,
  ): number;
  // Same for every connection in every loaded room that passes `predicate` (default: all).
  broadcastAllRooms(
    message: object,
    predicate?: (connection: Connection, room: Room) => boolean,
  ): number;
  // Drops a room from memory WITHOUT saving it and closes its connections with `closeCode`
  // (default 4404), so a deleted room is not written back by a pending save. Waits for a save
  // that is already running, so afterwards the host app can safely delete the stored copy.
  // Resolves false when the room was not loaded.
  discardRoom(roomId: string, closeCode?: number): Promise<boolean>;
  // Schedules a save for a loaded room whose `state` a handler changed from outside that room
  // (ctx.markDirty only covers the room the message came from). False if it is not loaded.
  markDirty(roomId: string): boolean;
}

const MAX_MESSAGE_BYTES = 64 * 1024;
const JOIN_TIMEOUT_MS = 5000;
const MAX_MESSAGES_PER_SECOND = 200;
// A client that does not read its socket would make us buffer without limit.
const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;
const MAX_TOKEN_LENGTH = 4096;

// Used when no authenticate hook is given. Anyone can join; the role is decided by the server
// (host for the first user into an empty room). Meant for local and self-hosted use.
const defaultAuthenticate: AuthenticateFn = (token, _request, join) => {
  return {
    userId: token || crypto.randomUUID(),
    roomId: join.roomId || 'default',
  };
};

export function createTabletopServer(options: TabletopServerOptions): TabletopServer {
  const storage = options.storage;
  const authenticate = options.authenticate || defaultAuthenticate;
  const debounceMs = options.saveDebounceMs === undefined ? 3000 : options.saveDebounceMs;
  const maxSaveDelayMs = options.maxSaveDelayMs || Math.max(debounceMs * 10, 1000);
  const logger = options.logger || createLogger('info');
  const handlers: { [name: string]: Handler } = Object.assign(
    {},
    builtInHandlers(),
    options.handlers || {},
  );

  const rooms = new Map<string, Room>();
  const loading = new Map<string, Promise<Room>>();
  const sockets = new Set<WebSocket>();
  const startedAt = Date.now();
  let stopping = false;
  let stopped = false;

  const httpServer = http.createServer((req, res) => {
    const path = (req.url || '').split('?')[0];
    if (req.method === 'GET' && path === '/health') {
      let connections = 0;
      rooms.forEach((room) => {
        connections += room.connections.size;
      });
      const body = {
        status: 'ok',
        rooms: rooms.size,
        connections,
        uptime: Math.round((Date.now() - startedAt) / 1000),
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    } else {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  function handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    if (stopping) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, req));
  }
  // The standalone server (and the old way of mounting: httpServer.emit('upgrade', ...)).
  httpServer.on('upgrade', handleUpgrade);

  // ---------- host app callbacks ----------

  // Hook calls for one user in one room run in order (a quick reconnect must not apply its
  // "leave" after its "join"), and are remembered so stop() can wait for them.
  const hookChains = new Map<string, Promise<void>>();
  function runHook(key: string, name: string, run: () => void | Promise<void>): void {
    const previous = hookChains.get(key) || Promise.resolve();
    const next: Promise<void> = previous
      .then(run)
      .catch((err) => logger.error(name + ' hook failed', { error: err && err.message }))
      .finally(() => {
        if (hookChains.get(key) === next) hookChains.delete(key);
      });
    hookChains.set(key, next);
  }

  // ---------- sending ----------

  function send(socket: WebSocket, message: object): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      socket.terminate();
      return;
    }
    try {
      socket.send(JSON.stringify(message));
    } catch (err) {
      logger.warn('send failed', { error: err.message });
    }
  }

  function sendError(socket: WebSocket, message: string, extra?: object): void {
    send(socket, { type: 'error', message, ...extra });
  }

  function broadcast(room: Room, message: object, except?: Connection): void {
    room.connections.forEach((c) => {
      if (c !== except) send(c.socket, message);
    });
  }

  // ---------- rooms and persistence ----------

  function getRoom(id: string): Promise<Room> {
    const existing = rooms.get(id);
    if (existing) return Promise.resolve(existing);
    // Two people joining at the same moment must share one load, or they'd get two states.
    let pending = loading.get(id);
    if (!pending) {
      pending = loadRoom(id).finally(() => loading.delete(id));
      loading.set(id, pending);
    }
    return pending;
  }

  async function loadRoom(id: string): Promise<Room> {
    const saved = await storage.loadRoom(id);
    const state = saved ? migrate(saved) : createEmptyState();
    const room: Room = {
      id,
      state,
      connections: new Set(),
      hosts: new Set(),
      dirty: false,
      discarded: false,
      dirtySince: 0,
      timer: null,
      saving: Promise.resolve(),
      connectionsOf: (userId) => Array.from(room.connections).filter((c) => c.userId === userId),
    };
    rooms.set(id, room);
    logger.info('room loaded', { roomId: id, existing: !!saved });
    return room;
  }

  // Mark changed and (re)start the debounce timer. Continuous changes (a long drag) keep pushing
  // the save back, but never further than maxSaveDelayMs after the first unsaved change.
  function markDirty(room: Room): void {
    if (room.discarded) return;
    const now = Date.now();
    if (!room.dirty) {
      room.dirty = true;
      room.dirtySince = now;
    }
    if (room.timer) clearTimeout(room.timer);
    const wait = Math.max(0, Math.min(debounceMs, room.dirtySince + maxSaveDelayMs - now));
    room.timer = setTimeout(() => {
      room.timer = null;
      flushRoom(room).catch(() => undefined);
    }, wait);
  }

  // Saves the room if it has unsaved changes. Never throws: a failed save is logged and the room
  // stays dirty, so the next change, a retry timer, or shutdown tries again.
  function flushRoom(room: Room): Promise<void> {
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }
    // Saves for one room run one after another so an older snapshot can't overwrite a newer one.
    room.saving = room.saving.then(async () => {
      if (room.discarded) return;
      if (!room.dirty) {
        unloadIfEmpty(room);
        return;
      }
      room.dirty = false;
      room.dirtySince = 0;
      try {
        await storage.saveRoom(room.id, structuredClone(room.state));
        logger.debug('room saved', { roomId: room.id });
      } catch (err) {
        room.dirty = true;
        room.dirtySince = Date.now();
        logger.error('room save failed', { roomId: room.id, error: err.message });
        if (!room.timer && !stopping) {
          room.timer = setTimeout(
            () => {
              room.timer = null;
              flushRoom(room).catch(() => undefined);
            },
            Math.max(debounceMs, 5000),
          );
        }
        return;
      }
      unloadIfEmpty(room);
    });
    return room.saving;
  }

  // Rooms with nobody in them and nothing unsaved are dropped from memory.
  function unloadIfEmpty(room: Room): void {
    if (room.connections.size === 0 && !room.dirty && rooms.get(room.id) === room) {
      rooms.delete(room.id);
      logger.info('room unloaded', { roomId: room.id });
    }
  }

  // ---------- connections ----------

  function onConnection(socket: WebSocket, request: http.IncomingMessage): void {
    sockets.add(socket);
    let phase: 'new' | 'joining' | 'joined' = 'new';
    let conn: Connection | null = null;
    let room: Room | null = null;
    let closed = false;
    let windowStart = Date.now();
    let windowCount = 0;
    let warnedThisWindow = false;

    const joinTimer = setTimeout(() => {
      if (phase !== 'joined') socket.close(4408, 'join timeout');
    }, JOIN_TIMEOUT_MS);

    socket.on('error', (err) => logger.warn('socket error', { error: err.message }));

    socket.on('close', () => {
      closed = true;
      clearTimeout(joinTimer);
      sockets.delete(socket);
      if (conn && room) leave(room, conn);
    });

    socket.on('message', (data, isBinary) => {
      // Simple fixed-window rate limit. Excess messages are dropped; we warn once per window so
      // that a flood doesn't also make us flood the client with errors.
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        windowCount = 0;
        warnedThisWindow = false;
      }
      windowCount += 1;
      if (windowCount > MAX_MESSAGES_PER_SECOND) {
        if (!warnedThisWindow) {
          warnedThisWindow = true;
          sendError(socket, 'rate limit exceeded');
        }
        return;
      }
      if (stopping) return;

      let message: Args;
      try {
        if (isBinary) throw new Error('binary');
        message = JSON.parse(data.toString());
      } catch {
        sendError(socket, 'messages must be JSON text');
        return;
      }
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        sendError(socket, 'message must be an object');
        return;
      }

      if (phase === 'new') {
        if (message.type !== 'join') {
          sendError(socket, 'first message must be join');
          socket.close(4400, 'join required');
          return;
        }
        phase = 'joining';
        join(message).catch((err) => {
          logger.error('join failed', { error: err.message });
          sendError(socket, 'join failed');
          socket.close(1011, 'join failed');
        });
      } else if (phase === 'joining') {
        sendError(socket, 'not joined yet; wait for the joined message');
      } else {
        handleMessage(room, conn, message, socket).catch((err) => {
          logger.error('message handling failed', { error: err.message });
        });
      }
    });

    async function join(message: Args): Promise<void> {
      const token = message.token === undefined ? '' : message.token;
      const wantedRoom = message.roomId;
      if (
        typeof token !== 'string' ||
        token.length > MAX_TOKEN_LENGTH ||
        (wantedRoom !== undefined && wantedRoom !== null && typeof wantedRoom !== 'string')
      ) {
        sendError(socket, 'invalid join message');
        socket.close(4400, 'invalid join');
        return;
      }

      let auth: AuthResult | null = null;
      try {
        auth = await authenticate(token, request, { roomId: (wantedRoom as string) || undefined });
      } catch (err) {
        // A broken auth hook must fail closed.
        logger.error('authenticate threw', { error: err.message });
      }
      if (closed) return;
      if (!auth || typeof auth.userId !== 'string' || !auth.userId || auth.userId.length > 256) {
        sendError(socket, 'unauthorized');
        socket.close(4401, 'unauthorized');
        return;
      }
      if (!isValidRoomId(auth.roomId)) {
        sendError(socket, 'invalid room id');
        socket.close(4400, 'invalid room');
        return;
      }

      let joinedRoom = await getRoom(auth.roomId);
      // The room may have been unloaded or discarded while we waited.
      if (!joinedRoom.discarded && rooms.get(joinedRoom.id) !== joinedRoom) {
        joinedRoom = await getRoom(auth.roomId);
      }
      if (closed || stopping) {
        unloadIfEmpty(joinedRoom); // don't keep a room loaded for a client that already left
        return;
      }
      if (joinedRoom.discarded) {
        sendError(socket, 'room not found');
        socket.close(ROOM_DISCARDED_CLOSE_CODE, 'room discarded');
        return;
      }

      // Role: the hook's answer wins, except that someone promoted with assignHost stays host.
      // With no role from the hook (the default), the first user into an empty room is host.
      let role = auth.role === 'host' || auth.role === 'player' ? auth.role : undefined;
      if (!role) role = joinedRoom.connections.size === 0 ? 'host' : 'player';
      if (joinedRoom.hosts.has(auth.userId)) role = 'host';
      if (role === 'host') joinedRoom.hosts.add(auth.userId);

      const alreadyPresent = joinedRoom.connectionsOf(auth.userId).length > 0;
      const newConn: Connection = {
        socket,
        userId: auth.userId,
        name: typeof auth.name === 'string' ? auth.name.slice(0, 256) : auth.userId,
        role,
      };
      joinedRoom.connections.add(newConn);
      conn = newConn;
      room = joinedRoom;
      phase = 'joined';
      clearTimeout(joinTimer);

      // Always the full state, so reconnecting clients resynchronise from scratch.
      send(socket, {
        type: 'joined',
        userId: newConn.userId,
        role: newConn.role,
        state: joinedRoom.state,
        members: memberList(joinedRoom),
      });
      if (!alreadyPresent) {
        broadcast(joinedRoom, presence('connected', newConn), newConn);
        // other connections of this same user are not "others", but there are none here anyway
      }
      logger.info('user joined', { roomId: joinedRoom.id, userId: newConn.userId, role });
      const onJoin = options.onJoin;
      if (onJoin) {
        const event: JoinEvent = {
          userId: newConn.userId,
          name: newConn.name,
          roomId: joinedRoom.id,
          role,
          connectionCount: joinedRoom.connectionsOf(newConn.userId).length,
        };
        runHook(joinedRoom.id + '\n' + newConn.userId, 'onJoin', () => onJoin(event));
      }
    }
  }

  function memberList(room: Room): object[] {
    const seen = new Set<string>();
    const list = [];
    room.connections.forEach((c) => {
      if (seen.has(c.userId)) return;
      seen.add(c.userId);
      list.push({ userId: c.userId, name: c.name, role: c.role });
    });
    return list;
  }

  function presence(event: string, c: Connection): object {
    return { type: 'presence', event, userId: c.userId, name: c.name };
  }

  function leave(room: Room, conn: Connection): void {
    room.connections.delete(conn);
    logger.info('user left', { roomId: room.id, userId: conn.userId });
    const remaining = room.connectionsOf(conn.userId).length;
    if (remaining === 0) {
      broadcast(room, presence('disconnected', conn));
    }
    const onLeave = options.onLeave;
    if (onLeave) {
      const event: LeaveEvent = {
        userId: conn.userId,
        roomId: room.id,
        role: conn.role,
        remainingConnectionsOfUser: remaining,
      };
      runHook(room.id + '\n' + conn.userId, 'onLeave', () => onLeave(event));
    }
    if (room.connections.size === 0) {
      // Last one out: save now (unloading happens inside flushRoom once it's saved).
      room.hosts.clear();
      flushRoom(room).catch(() => undefined);
    }
  }

  async function handleMessage(
    room: Room,
    conn: Connection,
    message: Args,
    socket: WebSocket,
  ): Promise<void> {
    const kind = message.type;
    let requestId: string | number | undefined;
    try {
      requestId = optionalEcho(message, 'requestId');
    } catch {
      sendError(socket, 'invalid requestId');
      return;
    }
    const idField = requestId === undefined ? {} : { requestId };

    if (kind !== 'update' && kind !== 'request') {
      sendError(socket, 'unknown message type', idField);
      return;
    }
    const name = message.name;
    if (
      typeof name !== 'string' ||
      name.length > 64 ||
      !Object.prototype.hasOwnProperty.call(handlers, name)
    ) {
      sendError(socket, 'unknown event', {
        name: typeof name === 'string' ? name.slice(0, 64) : undefined,
        ...idField,
      });
      return;
    }

    if (room.discarded) {
      sendError(socket, 'room not found', idField);
      return;
    }

    const ctx: HandlerContext = {
      kind,
      name,
      args: message.args as Args,
      user: conn,
      room,
      server: api,
      reply: (args, opts) =>
        send(socket, { type: 'response', name: (opts && opts.name) || name, args, ...idField }),
      broadcast: (args, opts) => {
        const options2 = opts || {};
        broadcast(
          room,
          { type: 'update', name: options2.name || name, args, from: conn.userId },
          options2.includeSelf ? undefined : conn,
        );
      },
      markDirty: () => markDirty(room),
    };

    try {
      await handlers[name](ctx);
    } catch (err) {
      if (err instanceof HandlerError) {
        sendError(socket, err.message, { name, ...idField });
      } else {
        // Bugs in a handler must not take the server down or leak details to clients.
        logger.error('handler crashed', { name, error: err && err.message });
        sendError(socket, 'internal error', { name, ...idField });
      }
    }
  }

  // ---------- helpers for the host app ----------

  function sendToUsers(
    userIds: string[],
    message: object,
    filter?: (connection: Connection, room: Room) => boolean,
  ): number {
    const wanted = new Set(userIds);
    return broadcastAllRooms(
      message,
      (c, room) => wanted.has(c.userId) && (!filter || filter(c, room)),
    );
  }

  function broadcastAllRooms(
    message: object,
    predicate?: (connection: Connection, room: Room) => boolean,
  ): number {
    let count = 0;
    rooms.forEach((room) => {
      room.connections.forEach((c) => {
        if (predicate && !predicate(c, room)) return;
        send(c.socket, message);
        count += 1;
      });
    });
    return count;
  }

  async function discardRoom(
    roomId: string,
    closeCode: number = ROOM_DISCARDED_CLOSE_CODE,
  ): Promise<boolean> {
    // A load that is still running would register the room right after we dropped it.
    const pending = loading.get(roomId);
    if (pending) await pending.catch(() => undefined);
    const room = rooms.get(roomId);
    if (!room) return false;
    room.discarded = true;
    room.dirty = false;
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    rooms.delete(roomId);
    Array.from(room.connections).forEach((c) => {
      try {
        c.socket.close(closeCode, 'room discarded');
      } catch {
        // already closing
      }
    });
    await room.saving; // a save that already started must finish before the caller deletes the row
    logger.info('room discarded', { roomId });
    return true;
  }

  // ---------- lifecycle ----------

  function start(): Promise<number> {
    return new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(options.port === undefined ? 0 : options.port, options.host, () => {
        httpServer.off('error', reject);
        const address = httpServer.address();
        const port = typeof address === 'object' && address ? address.port : options.port;
        logger.info('server listening', { port });
        resolve(port);
      });
    });
  }

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    stopping = true;
    // Save first, then say goodbye, so clients that see the close can trust the data is safe.
    await Promise.all(Array.from(rooms.values()).map((room) => flushRoom(room)));
    rooms.forEach((room) => {
      if (room.timer) clearTimeout(room.timer);
      room.timer = null;
    });
    const waiting: Promise<void>[] = [];
    sockets.forEach((socket) => {
      waiting.push(new Promise((resolve) => socket.once('close', () => resolve())));
      socket.close(1001, 'server shutting down');
    });
    // Don't let a client that ignores the close handshake block shutdown.
    await Promise.race([Promise.all(waiting), new Promise((resolve) => setTimeout(resolve, 1000))]);
    sockets.forEach((socket) => socket.terminate());
    wss.close();
    if (httpServer.listening) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeAllConnections();
      });
    }
    // Disconnect handlers may have re-flushed; make sure nothing dirty is left behind.
    await Promise.all(Array.from(rooms.values()).map((room) => flushRoom(room)));
    // onLeave hooks for the sockets closed above.
    await Promise.all(Array.from(hookChains.values()));
    logger.info('server stopped');
  }

  const api: TabletopServer = {
    start,
    stop,
    httpServer,
    rooms,
    handleUpgrade,
    sendToUsers,
    broadcastAllRooms,
    discardRoom,
    markDirty(roomId: string): boolean {
      const room = rooms.get(roomId);
      if (!room) return false;
      markDirty(room);
      return true;
    },
  };
  return api;
}

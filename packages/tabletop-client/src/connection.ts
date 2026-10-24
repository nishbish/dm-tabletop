// The transport adapter. The viewer (tabletop.js) speaks the original client's vocabulary:
// sendMessage('update' | 'request', name, args) out, updateClient[name](args) /
// clientRequest[name](args) in. This module connects that to protocol v2 of tabletop-server and
// adds what a real network needs: reconnecting, throttling, message ordering and graceful
// degradation for events that only a host app implements.

import { ResolvedOptions } from './config';
import { createDemoRoom } from './demo';
import { builtInModels, ModelResolver, modelToArgs } from './models';
import {
  Args,
  COALESCED,
  fromServerUpdate,
  ID_KEYS,
  stateToRoom,
  TEMP_KEYS,
  toServer,
} from './protocol';

export type StatusState = 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'offline';

export interface Status {
  state: StatusState;
  attempt?: number;
  delayMs?: number;
  message?: string;
}

// What the viewer implements.
export interface Sink {
  // Called before a full state is applied for the second and later time (after a reconnect or a
  // room switch): the viewer must remove everything it built from the previous state.
  reset(): void;
  update(name: string, args: Args): void;
  request(name: string, args: Args): void;
  status(status: Status): void;
  notify(message: string, level?: 'info' | 'error'): void;
}

export interface Connection {
  connect(): void;
  close(): void;
  send(type: 'update' | 'request', name: string, args: Args): void;
  switchRoom(roomId: string): void;
  readonly roomId: string;
  readonly status: StatusState;
}

export const MAX_BACKOFF_MS = 15000;
const BASE_BACKOFF_MS = 1000;
// ~20 messages per second per dragged object
export const THROTTLE_INTERVAL_MS = 50;
// Upper bound for all throttled messages together (the server drops beyond 200 messages/s).
const MAX_THROTTLED_PER_WINDOW = 8;

// Delay before reconnect attempt number `attempt` (0 = first retry): 1 s, 2 s, 4 s, 8 s, then
// 15 s. `random` (0..1) adds +-20 % jitter so a restarted server isn't hit by everyone at once.
export function backoffDelay(attempt: number, random: () => number = () => 0.5): number {
  const base = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, attempt));
  return Math.min(MAX_BACKOFF_MS, Math.round(base * (0.8 + 0.4 * random())));
}

// Close codes after which retrying cannot help.
const FATAL_CLOSE_CODES = [4400, 4401, 4404];
// A token provider that has not answered after this long counts as failed.
const TOKEN_TIMEOUT_MS = 15000;

// Host-app events: friendly text when the server does not know them.
const UNSUPPORTED_TEXT: Record<string, string> = {
  getRooms: 'Room management is not available on this server.',
  addRoom: 'Room management is not available on this server.',
  deleteRoom: 'Room management is not available on this server.',
  deleteModel: 'Deleting tokens is not available on this server.',
  deletePlaneUpload: 'Deleting images is not available on this server.',
  editModel: 'Editing tokens is not available on this server.',
  refreshInviteCode: 'Invite links are not available on this server.',
  focusCamera: "Focusing everyone's camera is not available on this server.",
};

interface Held {
  name: string;
  args: Args;
}

export function createConnection(options: ResolvedOptions, sink: Sink): Connection {
  const resolver = new ModelResolver(options);
  let roomId = options.roomId;
  let socket: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  let state: StatusState = 'connecting';
  let joined = false;
  let joinedBefore = false;
  let closedByUs = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0; // identifies the current socket; stale callbacks are ignored
  let chain: Promise<void> = Promise.resolve();
  let requestCounter = 0;

  // ids we asked the server to create and have not seen come back yet -> messages held for them
  const unresolved = new Set<string>();
  const held = new Map<string, Held[]>();
  const pendingRequests = new Map<string, string>();
  // host-app events the server told us it does not know: answered locally from then on
  const unsupported = new Set<string>();

  // throttle state
  const lastSent = new Map<string, number>();
  const throttled = new Map<string, Held>();
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  let windowStart = 0;
  let windowCount = 0;

  const recentNotes = new Map<string, number>();

  function setStatus(next: Status): void {
    state = next.state;
    sink.status(next);
  }

  function note(message: string, level: 'info' | 'error' = 'info'): void {
    const now = Date.now();
    const last = recentNotes.get(message);
    if (last !== undefined && now - last < 3000) return;
    recentNotes.set(message, now);
    sink.notify(message, level);
  }

  // ---------- local answers ----------

  function legacyModelList(): Args[] {
    return builtInModels().map((m) => ({
      modelId: m.id,
      name: m.name,
      src: '',
      baseColor: m.baseColor,
      ownerId: '0',
    }));
  }

  // Replies the viewer needs to keep working on a server without an asset library.
  function answerLocally(name: string): boolean {
    if (name === 'getModels') {
      sink.request('getModels', {
        folders: [],
        models: legacyModelList(),
        folderId: 0,
        parentId: 0,
        showNext: false,
      });
      return true;
    }
    if (name === 'getPlaneImages') {
      sink.request('getPlaneImages', {
        folders: [],
        planes: [],
        folderId: 0,
        parentId: 0,
        showNext: false,
        allowUrl: true,
      });
      return true;
    }
    return false;
  }

  function unsupportedMessage(name: string): void {
    note(UNSUPPORTED_TEXT[name] || `"${name}" is not supported by this server.`);
  }

  // ---------- sending ----------

  function rawSend(message: Args): void {
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify(message));
    }
  }

  function sendUpdate(name: string, args: Args): void {
    rawSend({ type: 'update', name, args });
  }

  function flushThrottled(): void {
    throttleTimer = null;
    const now = Date.now();
    if (now - windowStart >= THROTTLE_INTERVAL_MS) {
      windowStart = now;
      windowCount = 0;
    }
    for (const [key, msg] of Array.from(throttled.entries())) {
      if (windowCount >= MAX_THROTTLED_PER_WINDOW) break;
      if (now - (lastSent.get(key) || 0) < THROTTLE_INTERVAL_MS) continue;
      throttled.delete(key);
      lastSent.set(key, now);
      windowCount++;
      sendUpdate(msg.name, msg.args);
    }
    if (throttled.size > 0) {
      throttleTimer = setTimeout(flushThrottled, THROTTLE_INTERVAL_MS);
    }
  }

  function sendThrottled(key: string, name: string, args: Args): void {
    const now = Date.now();
    if (now - windowStart >= THROTTLE_INTERVAL_MS) {
      windowStart = now;
      windowCount = 0;
    }
    const idle = now - (lastSent.get(key) || 0) >= THROTTLE_INTERVAL_MS;
    if (idle && !throttled.has(key) && windowCount < MAX_THROTTLED_PER_WINDOW) {
      lastSent.set(key, now);
      windowCount++;
      sendUpdate(name, args);
      return;
    }
    throttled.set(key, { name, args });
    if (!throttleTimer) throttleTimer = setTimeout(flushThrottled, THROTTLE_INTERVAL_MS);
  }

  function dropThrottledFor(id: string): void {
    for (const key of Array.from(throttled.keys())) {
      if (key.endsWith(':' + id)) throttled.delete(key);
    }
  }

  function hold(id: string, name: string, args: Args): void {
    const list = held.get(id) || [];
    // later position/transform updates replace earlier ones, like the throttle does
    const index = COALESCED.includes(name) ? list.findIndex((h) => h.name === name) : -1;
    if (index >= 0) list[index] = { name, args };
    else list.push({ name, args });
    held.set(id, list);
  }

  function send(type: 'update' | 'request', name: string, args: Args = {}): void {
    if (name === 'getModel') {
      // Answered by the model resolver, never by the server.
      const modelId = String(args.modelId);
      resolver.resolve(modelId).then((model) => sink.request('getModel', modelToArgs(model)));
      return;
    }
    if (options.demo) {
      if (type === 'request' && !answerLocally(name)) unsupportedMessage(name);
      return;
    }
    if (type === 'request' && unsupported.has(name) && answerLocally(name)) return;
    if (!joined) {
      note('Not connected: your last change was not sent.', 'error');
      return;
    }

    const translated = toServer(name, args);
    if (!translated) return;

    if (type === 'request') {
      if (unsupported.has(name)) {
        unsupportedMessage(name);
        return;
      }
      const requestId = 'r' + ++requestCounter;
      pendingRequests.set(requestId, name);
      rawSend({ type: 'request', name: translated.name, args: translated.args, requestId });
      return;
    }

    // create events: remember the temp id until the server's answer arrives
    const temp = TEMP_KEYS[name];
    if (temp) {
      unresolved.add(String(translated.args.tempId));
      sendUpdate(translated.name, translated.args);
      return;
    }

    const idKey = ID_KEYS[name];
    const id = idKey ? String(translated.args[idKey]) : null;

    if (id !== null && unresolved.has(id)) {
      // The server has not numbered this object yet; send once it has.
      if (name.startsWith('remove')) held.set(id, []);
      hold(id, translated.name, translated.args);
      return;
    }

    if (id !== null && name.startsWith('remove')) dropThrottledFor(id);

    if (id !== null && COALESCED.includes(name)) {
      sendThrottled(`${translated.name}:${id}`, translated.name, translated.args);
      return;
    }
    sendUpdate(translated.name, translated.args);
  }

  // ---------- receiving ----------

  async function onJoined(msg: Args): Promise<void> {
    const gameState: Args = msg.state || {};
    const modelIds = new Set<string>();
    Object.values<Args>(gameState.tokens || {}).forEach((t) => modelIds.add(String(t.modelId)));
    const models = await Promise.all(Array.from(modelIds).map((id) => resolver.resolve(id)));

    const members = Array.isArray(msg.members) ? msg.members : [];
    const self = members.find((m: Args) => m.userId === msg.userId);
    const name = self ? self.name : msg.userId;
    const room = stateToRoom(
      gameState,
      { userId: msg.userId, role: msg.role, name },
      members,
      models,
    );
    for (const id of Object.keys(room.clients)) {
      room.clients[id].picture = options.avatarUrl({ userId: id, name: room.clients[id].name });
    }

    if (joinedBefore) sink.reset();
    joinedBefore = true;
    joined = true;
    attempt = 0;
    recentNotes.clear();
    sink.update('userJoined', {
      user_id: msg.userId,
      name,
      picture: options.avatarUrl({ userId: msg.userId, name }),
      room,
    });
    setStatus({ state: 'connected' });
  }

  async function onUpdate(name: string, args: Args, from?: string): Promise<void> {
    // Make sure the viewer knows the models a message refers to before it gets the message.
    if (name === 'addToken' || name === 'updateTokenModel') {
      const model = await resolver.resolve(String(args.modelId));
      sink.update('defineModel', modelToArgs(model));
    }

    for (const t of fromServerUpdate(name, args, from)) {
      sink.update(t.name, t.args);
    }

    // The server answered one of our create events: send what was waiting for the real id.
    const temp = TEMP_KEYS[name];
    if (temp && args.tempId !== undefined && unresolved.delete(String(args.tempId))) {
      const tempId = String(args.tempId);
      const realId = String(args[temp.real]);
      const waiting = held.get(tempId) || [];
      held.delete(tempId);
      const idKey = Object.values(ID_KEYS).find((k) => k === temp.real);
      for (const h of waiting) {
        sendUpdate(h.name, idKey ? { ...h.args, [idKey]: realId } : h.args);
      }
    }
  }

  function onError(msg: Args): void {
    const message = String(msg.message || 'error');
    const requestName =
      msg.requestId !== undefined ? pendingRequests.get(String(msg.requestId)) : undefined;
    if (msg.requestId !== undefined) pendingRequests.delete(String(msg.requestId));
    const name: string | undefined = requestName || msg.name;

    if (message === 'unknown event' && name) {
      unsupported.add(name);
      if (requestName && answerLocally(name)) return;
      unsupportedMessage(name);
      return;
    }
    // permission problems, vanished objects, rate limits...: tell the player, keep going
    note(message.charAt(0).toUpperCase() + message.slice(1) + '.', 'error');
  }

  function handleMessage(msg: Args): Promise<void> | void {
    switch (msg.type) {
      case 'joined':
        return onJoined(msg);
      case 'update':
        return onUpdate(String(msg.name), msg.args || {}, msg.from);
      case 'response':
        if (msg.requestId !== undefined) pendingRequests.delete(String(msg.requestId));
        sink.request(String(msg.name), msg.args || {});
        return;
      case 'presence':
        if (msg.event === 'connected') {
          sink.update('clientConnected', {
            user_id: msg.userId,
            name: msg.name,
            picture: options.avatarUrl({ userId: msg.userId, name: msg.name }),
          });
        } else {
          sink.update('clientDisconnected', { user_id: msg.userId });
        }
        return;
      case 'error':
        return onError(msg);
      default:
        return;
    }
  }

  // ---------- socket lifecycle ----------

  function resetSessionState(): void {
    joined = false;
    unresolved.clear();
    held.clear();
    pendingRequests.clear();
    throttled.clear();
    lastSent.clear();
    if (throttleTimer) clearTimeout(throttleTimer);
    throttleTimer = null;
  }

  function open(): void {
    const mine = ++generation;
    resetSessionState();
    setStatus(
      attempt === 0 && !joinedBefore ? { state: 'connecting' } : { state: 'reconnecting', attempt },
    );
    const source = options.token;
    if (typeof source !== 'function') {
      openSocket(mine, source);
      return;
    }
    // A token function runs for every attempt. If it fails or hangs this attempt failed, and the
    // normal backoff applies. An error with `fatal: true` (a login that can never work, e.g. the
    // member was removed) stops the retrying instead.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), TOKEN_TIMEOUT_MS);
    });
    Promise.race([Promise.resolve().then(() => source({ roomId })), timeout]).then(
      (value) => {
        if (timer) clearTimeout(timer);
        if (mine !== generation) return;
        if (typeof value !== 'string') return tokenFailed(new Error('not a string'));
        openSocket(mine, value);
      },
      (err) => {
        if (timer) clearTimeout(timer);
        if (mine === generation) tokenFailed(err);
      },
    );
  }

  function tokenFailed(err: { fatal?: boolean; message?: string } | null): void {
    if (err && err.fatal === true) {
      const message = String(err.message || 'The server did not accept this login.');
      setStatus({ state: 'failed', message });
      sink.notify(message, 'error');
      return;
    }
    scheduleReconnect('Could not get a login token');
  }

  function openSocket(mine: number, token: string): void {
    const Impl = (options.WebSocketImpl as any) || WebSocket; // eslint-disable-line @typescript-eslint/no-explicit-any
    let ws: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      ws = new Impl(options.serverUrl);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = ws;
    ws.onopen = () => {
      if (mine !== generation) return;
      ws.send(JSON.stringify({ type: 'join', token, roomId }));
    };
    ws.onmessage = (event: { data: unknown }) => {
      if (mine !== generation) return;
      let msg: Args;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      // One message at a time, in order, even when handling one needs an async model lookup.
      chain = chain
        .then(() => handleMessage(msg))
        .catch((err) => console.warn('message failed', err));
    };
    ws.onerror = () => {
      // onclose follows; nothing to do
    };
    ws.onclose = (event: { code?: number }) => {
      if (mine !== generation || closedByUs) return;
      joined = false;
      const code = event && event.code;
      if (code !== undefined && FATAL_CLOSE_CODES.includes(code)) {
        const message =
          code === 4401
            ? 'The server did not accept this login.'
            : code === 4404
              ? 'This room no longer exists.'
              : 'The server rejected the join request.';
        setStatus({ state: 'failed', message });
        sink.notify(message, 'error');
        return;
      }
      scheduleReconnect();
    };
  }

  function scheduleReconnect(message?: string): void {
    const delayMs = backoffDelay(attempt);
    attempt++;
    setStatus({ state: 'reconnecting', attempt, delayMs, message });
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!closedByUs) open();
    }, delayMs);
  }

  function closeSocket(): void {
    generation++;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    if (socket) {
      const old = socket;
      socket = null;
      try {
        old.close(1000);
      } catch {
        // already closed
      }
    }
  }

  return {
    connect() {
      if (options.demo) {
        const room = options.demoRoom
          ? JSON.parse(JSON.stringify(options.demoRoom))
          : createDemoRoom();
        const modelIds = new Set<string>(
          Object.values<Args>(room.tokens).map((t) => String(t.modelId)),
        );
        Promise.all(Array.from(modelIds).map((id) => resolver.resolve(id))).then((models) => {
          room.models = models;
          joined = true;
          const you = { userId: 'demo-user', name: 'You' };
          room.clients['demo-user'].picture = options.avatarUrl(you);
          sink.update('userJoined', {
            user_id: you.userId,
            name: you.name,
            picture: options.avatarUrl(you),
            room,
          });
          setStatus({ state: 'offline' });
        });
        return;
      }
      closedByUs = false;
      open();
    },
    close() {
      closedByUs = true;
      closeSocket();
    },
    send,
    switchRoom(next: string) {
      if (options.demo || next === roomId) return;
      roomId = next;
      attempt = 0;
      closeSocket();
      closedByUs = false;
      open();
    },
    get roomId() {
      return roomId;
    },
    get status() {
      return state;
    },
  };
}

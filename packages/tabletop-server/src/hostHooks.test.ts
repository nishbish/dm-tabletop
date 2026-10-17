/* eslint-disable @typescript-eslint/no-explicit-any -- test helpers deal in loose JSON */
// The hooks a hosting app uses: mounting on its own http server, join/leave callbacks, reaching
// members of other rooms, and discarding a room.
import * as http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createLogger } from './logger';
import { createTabletopServer, TabletopServer } from './server';
import { MemoryStorage } from './storage/memory';
import { sleep, startTestServer, TestClient } from './testUtils';
import { JoinEvent, LeaveEvent, RoomState, RoomStorage } from './types';

let toStop: TabletopServer[] = [];
let httpToClose: http.Server[] = [];
afterEach(async () => {
  for (const server of toStop) await server.stop();
  for (const h of httpToClose) await new Promise<void>((r) => h.close(() => r()));
  toStop = [];
  httpToClose = [];
});

async function setup(options: any = {}) {
  const result = await startTestServer({ storage: new MemoryStorage(), ...options });
  toStop.push(result.server);
  return result;
}

async function until(check: () => boolean, ms = 2000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await sleep(10);
  }
}

describe('handleUpgrade', () => {
  it('lets a host app mount the server on its own http server', async () => {
    const tabletop = createTabletopServer({
      storage: new MemoryStorage(),
      logger: createLogger('silent'),
    });
    toStop.push(tabletop);
    const app = http.createServer((_req, res) => res.end('app'));
    app.on('upgrade', (req, socket, head) => {
      if (req.url === '/ws') tabletop.handleUpgrade(req, socket, head);
      else socket.destroy();
    });
    await new Promise<void>((r) => app.listen(0, '127.0.0.1', () => r()));
    httpToClose.push(app);
    const port = (app.address() as any).port;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const client = new TestClient(ws);
    await new Promise((r) => ws.once('open', r));
    client.send({ type: 'join', token: 'alice', roomId: 'r1' });
    expect((await client.nextType('joined')).userId).toBe('alice');

    await expect(
      new Promise((resolve, reject) => {
        const other = new WebSocket(`ws://127.0.0.1:${port}/other`);
        other.once('open', resolve);
        other.once('error', reject);
      }),
    ).rejects.toThrow();
  });

  it('keeps the emit("upgrade") way working', async () => {
    const tabletop = createTabletopServer({
      storage: new MemoryStorage(),
      logger: createLogger('silent'),
    });
    toStop.push(tabletop);
    const app = http.createServer();
    app.on('upgrade', (req, socket, head) =>
      tabletop.httpServer.emit('upgrade', req, socket, head),
    );
    await new Promise<void>((r) => app.listen(0, '127.0.0.1', () => r()));
    httpToClose.push(app);
    const port = (app.address() as any).port;
    const { client } = await TestClient.join(port, 'bob', 'r1');
    expect(client).toBeTruthy();
  });
});

describe('onJoin and onLeave', () => {
  it('report each connection with the user connection counts', async () => {
    const joins: JoinEvent[] = [];
    const leaves: LeaveEvent[] = [];
    const { port } = await setup({
      onJoin: (e: JoinEvent) => void joins.push(e),
      onLeave: (e: LeaveEvent) => void leaves.push(e),
    });
    const a1 = await TestClient.join(port, 'alice', 'r1');
    const a2 = await TestClient.join(port, 'alice', 'r1');
    const b = await TestClient.join(port, 'bob', 'r1');
    await until(() => joins.length === 3);
    expect(joins[0]).toMatchObject({
      userId: 'alice',
      roomId: 'r1',
      role: 'host',
      connectionCount: 1,
    });
    expect(joins[1]).toMatchObject({ userId: 'alice', connectionCount: 2 });
    expect(joins[2]).toMatchObject({ userId: 'bob', role: 'player', connectionCount: 1 });

    a1.client.close();
    await until(() => leaves.length === 1);
    expect(leaves[0]).toMatchObject({
      userId: 'alice',
      roomId: 'r1',
      role: 'host',
      remainingConnectionsOfUser: 1,
    });
    a2.client.close();
    b.client.close();
    await until(() => leaves.length === 3);
    expect(leaves[1].remainingConnectionsOfUser).toBe(0);
  });

  it('are not called for rejected joins', async () => {
    const joins: JoinEvent[] = [];
    const leaves: LeaveEvent[] = [];
    const { port } = await setup({
      authenticate: () => null,
      onJoin: (e: JoinEvent) => void joins.push(e),
      onLeave: (e: LeaveEvent) => void leaves.push(e),
    });
    const client = await TestClient.connect(port);
    client.send({ type: 'join', token: 'x', roomId: 'r1' });
    expect(await client.waitForClose()).toBe(4401);
    await sleep(50);
    expect(joins).toEqual([]);
    expect(leaves).toEqual([]);
  });

  it('survive hooks that throw or reject, and run in order per user', async () => {
    const order: string[] = [];
    const { port } = await setup({
      onJoin: async () => {
        await sleep(60); // slow join
        order.push('join');
        throw new Error('join hook broke');
      },
      onLeave: () => {
        order.push('leave');
        return Promise.reject(new Error('leave hook broke'));
      },
    });
    const { client } = await TestClient.join(port, 'alice', 'r1');
    client.close(); // leaves while the join hook is still sleeping
    await until(() => order.length === 2);
    expect(order).toEqual(['join', 'leave']);
    // The server still works.
    const again = await TestClient.join(port, 'alice', 'r1');
    expect(again.joined.type).toBe('joined');
  });

  it('stop() waits for hooks that are still running', async () => {
    let finished = false;
    const { port, server } = await setup({
      onLeave: async () => {
        await sleep(150);
        finished = true;
      },
    });
    await TestClient.join(port, 'alice', 'r1');
    await server.stop();
    expect(finished).toBe(true);
  });
});

describe('reaching other rooms', () => {
  it('sendToUsers and broadcastAllRooms cross room boundaries', async () => {
    const { port, server } = await setup();
    const a = await TestClient.join(port, 'alice', 'r1');
    const b = await TestClient.join(port, 'bob', 'r2');
    const c = await TestClient.join(port, 'carol', 'r2');

    const sent = server.sendToUsers(['bob'], { type: 'update', name: 'hello', args: { n: 1 } });
    expect(sent).toBe(1);
    expect((await b.client.nextUpdate('hello')).args).toEqual({ n: 1 });

    const filtered = server.sendToUsers(
      ['bob', 'carol'],
      { type: 'update', name: 'only-r1' },
      (_c, room) => room.id === 'r1',
    );
    expect(filtered).toBe(0);

    const all = server.broadcastAllRooms(
      { type: 'update', name: 'camera', args: {} },
      (conn) => conn.userId !== 'carol',
    );
    expect(all).toBe(2);
    await a.client.nextUpdate('camera');
    await b.client.nextUpdate('camera');
    await sleep(50);
    expect(c.client.messages.some((m: any) => m.name === 'camera')).toBe(false);
  });

  it('is reachable from handlers as ctx.server, with user and room info', async () => {
    const seen: any[] = [];
    const { port } = await setup({
      handlers: {
        notifyEveryone(ctx: any) {
          seen.push({
            userId: ctx.user.userId,
            role: ctx.user.role,
            name: ctx.user.name,
            room: ctx.room.id,
          });
          ctx.server.broadcastAllRooms({
            type: 'update',
            name: 'notice',
            args: { from: ctx.user.userId },
          });
        },
      },
      authenticate: (token: string) => ({
        userId: token,
        roomId: token === 'a' ? 'r1' : 'r2',
        name: 'N-' + token,
      }),
    });
    const a = await TestClient.join(port, 'a', 'r1');
    const b = await TestClient.join(port, 'b', 'r2');
    a.client.send({ type: 'update', name: 'notifyEveryone', args: {} });
    expect((await b.client.nextUpdate('notice')).args).toEqual({ from: 'a' });
    expect(seen[0]).toEqual({ userId: 'a', role: 'host', name: 'N-a', room: 'r1' });
  });
});

class SpyStorage implements RoomStorage {
  inner = new MemoryStorage();
  saves: string[] = [];
  delayMs = 0;
  loadRoom(id: string) {
    return this.inner.loadRoom(id);
  }
  async saveRoom(id: string, state: RoomState) {
    if (this.delayMs) await sleep(this.delayMs);
    this.saves.push(id);
    return this.inner.saveRoom(id, state);
  }
}

describe('reply name and markDirty', () => {
  it('reply can answer under another name and keeps the requestId', async () => {
    const { port } = await setup({
      handlers: { addThing: (ctx: any) => ctx.reply({ things: [1] }, { name: 'getThings' }) },
    });
    const { client } = await TestClient.join(port, 'a', 'r1');
    client.send({ type: 'request', name: 'addThing', args: {}, requestId: 'q1' });
    const answer = await client.next((m) => m.type === 'response');
    expect(answer).toEqual({
      type: 'response',
      name: 'getThings',
      args: { things: [1] },
      requestId: 'q1',
    });
  });

  it('server.markDirty saves a loaded room changed from outside', async () => {
    const storage = new SpyStorage();
    const { port, server } = await setup({ storage, saveDebounceMs: 20 });
    await TestClient.join(port, 'a', 'r1');
    server.rooms.get('r1')!.state.daylight = 7;
    expect(server.markDirty('r1')).toBe(true);
    expect(server.markDirty('nope')).toBe(false);
    await sleep(150);
    expect((await storage.loadRoom('r1'))!.daylight).toBe(7);
  });
});

describe('discardRoom', () => {
  it('drops the room without saving and closes its connections', async () => {
    const storage = new SpyStorage();
    const { port, server } = await setup({ storage, saveDebounceMs: 30 });
    const host = await TestClient.join(port, 'alice', 'r1');
    const other = await TestClient.join(port, 'bob', 'r2');
    host.client.send({ type: 'update', name: 'addDoor', args: { x: 1, z: 1 } });
    await host.client.nextUpdate('addDoor');
    host.client.send({ type: 'update', name: 'updateDaylight', args: { daylight: 5 } }); // dirty, unsaved

    expect(await server.discardRoom('r1')).toBe(true);
    expect(await host.client.waitForClose()).toBe(4404);
    await sleep(150); // longer than the debounce
    expect(storage.saves).not.toContain('r1');
    expect(server.rooms.has('r1')).toBe(false);
    expect(server.rooms.has('r2')).toBe(true);
    other.client.send({ type: 'request', name: 'getState', args: {}, requestId: 'x' });
    await other.client.next((m) => m.type === 'response');

    expect(await server.discardRoom('nope')).toBe(false);
  });

  it('waits for a save that is already running, and never saves afterwards', async () => {
    const storage = new SpyStorage();
    storage.delayMs = 150;
    const { port, server } = await setup({ storage, saveDebounceMs: 10 });
    const { client } = await TestClient.join(port, 'alice', 'r1');
    client.send({ type: 'update', name: 'updateDaylight', args: { daylight: 5 } });
    await sleep(60); // the save has started and is sleeping
    expect(storage.saves).toEqual([]);
    await server.discardRoom('r1');
    expect(storage.saves).toEqual(['r1']); // finished before discardRoom resolved
    client.send({ type: 'update', name: 'updateDaylight', args: { daylight: 6 } });
    await sleep(200);
    expect(storage.saves).toEqual(['r1']);
  });

  it('lets people join again afterwards with a fresh room', async () => {
    const { port, server } = await setup();
    const first = await TestClient.join(port, 'alice', 'r1');
    first.client.send({ type: 'update', name: 'addDoor', args: { x: 1, z: 1 } });
    await first.client.nextUpdate('addDoor');
    await server.discardRoom('r1');
    await first.client.waitForClose();
    const again = await TestClient.join(port, 'alice', 'r1');
    expect(again.joined.state.doors).toEqual({});
  });
});

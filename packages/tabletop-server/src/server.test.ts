/* eslint-disable @typescript-eslint/no-explicit-any -- test helpers deal in loose JSON */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { FileStorage } from './storage/file';
import { MemoryStorage } from './storage/memory';
import { TabletopServer } from './server';
import { sleep, startTestServer, TestClient } from './testUtils';
import { RoomState, RoomStorage } from './types';

// Wraps a storage and counts saves, optionally failing on demand.
class CountingStorage implements RoomStorage {
  saves = 0;
  failNext = false;
  inner = new MemoryStorage();
  loadRoom(id: string) {
    return this.inner.loadRoom(id);
  }
  async saveRoom(id: string, state: RoomState) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('disk on fire');
    }
    this.saves += 1;
    return this.inner.saveRoom(id, state);
  }
}

let toStop: TabletopServer[] = [];
afterEach(async () => {
  for (const server of toStop) await server.stop();
  toStop = [];
});

async function setup(options: any = {}) {
  const result = await startTestServer({ storage: new MemoryStorage(), ...options });
  toStop.push(result.server);
  return result;
}

// Joins a host (first in) and a player to the same room.
async function hostAndPlayer(port: number, roomId = 'r1') {
  const host = await TestClient.join(port, 'host-user', roomId);
  const player = await TestClient.join(port, 'player-user', roomId);
  return {
    host: host.client,
    player: player.client,
    hostJoined: host.joined,
    playerJoined: player.joined,
  };
}

describe('join', () => {
  it('sends the full state and roles, and announces presence', async () => {
    const { port } = await setup();
    const first = await TestClient.join(port, 'alice', 'r1');
    expect(first.joined.role).toBe('host');
    expect(first.joined.userId).toBe('alice');
    expect(first.joined.state.version).toBe(1);
    expect(first.joined.state.tokens).toEqual({});

    const second = await TestClient.join(port, 'bob', 'r1');
    expect(second.joined.role).toBe('player');
    const presence = await first.client.nextType('presence');
    expect(presence).toMatchObject({ event: 'connected', userId: 'bob' });

    second.client.close();
    const gone = await first.client.next(
      (m) => m.type === 'presence' && m.event === 'disconnected',
    );
    expect(gone.userId).toBe('bob');
  });

  it('rejects when authenticate returns null', async () => {
    const { port } = await setup({ authenticate: () => null });
    const client = await TestClient.connect(port);
    client.send({ type: 'join', token: 'nope' });
    expect((await client.nextType('error')).message).toBe('unauthorized');
    expect(await client.waitForClose()).toBe(4401);
  });

  it('treats a throwing authenticate as unauthorized', async () => {
    const { port } = await setup({
      authenticate: () => {
        throw new Error('boom');
      },
    });
    const client = await TestClient.connect(port);
    client.send({ type: 'join', token: 'x' });
    expect(await client.waitForClose()).toBe(4401);
  });

  it('closes a connection whose first message is not a join', async () => {
    const { port } = await setup();
    const client = await TestClient.connect(port);
    client.send({ type: 'update', name: 'ping', args: {} });
    expect((await client.nextType('error')).message).toContain('join');
    expect(await client.waitForClose()).toBe(4400);
  });

  it('closes a connection that never joins', async () => {
    const { port } = await setup();
    const client = await TestClient.connect(port);
    const started = Date.now();
    expect(await client.waitForClose(7000)).toBe(4408);
    expect(Date.now() - started).toBeGreaterThan(4000);
  }, 10000);

  it('rejects unsafe room ids', async () => {
    const { port } = await setup();
    const client = await TestClient.connect(port);
    client.send({ type: 'join', token: 'a', roomId: '../evil' });
    expect(await client.waitForClose()).toBe(4400);
  });

  it('gives reconnecting users the full current state', async () => {
    const { port } = await setup();
    const { host, player } = await hostAndPlayer(port);
    host.send({ type: 'update', name: 'addToken', args: { modelId: 'orc', x: 1, y: 0, z: 2 } });
    await host.nextUpdate('addToken');
    player.close();
    await host.next((m) => m.type === 'presence' && m.event === 'disconnected');

    const again = await TestClient.join(port, 'player-user', 'r1');
    expect(Object.keys(again.joined.state.tokens)).toHaveLength(1);
    expect(again.joined.state.tokens['1'].position).toEqual({ x: 1, y: 0, z: 2 });
  });

  it('allows several connections per user', async () => {
    const { port } = await setup();
    const a = await TestClient.join(port, 'alice', 'r1');
    const b = await TestClient.join(port, 'alice', 'r1');
    expect(b.joined.role).toBe('host'); // promoted users stay hosts
    a.client.send({ type: 'update', name: 'updateDaylight', args: { daylight: 5 } });
    expect((await b.client.nextUpdate('updateDaylight')).args.daylight).toBe(5);
  });
});

describe('events and roles', () => {
  it('broadcasts addToken to everyone including the sender, with server id and tempId', async () => {
    const { port } = await setup();
    const { host, player } = await hostAndPlayer(port);
    host.send({
      type: 'update',
      name: 'addToken',
      args: { modelId: 'orc', x: 1, y: 0, z: 2, tempId: 77 },
    });
    const own = await host.nextUpdate('addToken');
    const other = await player.nextUpdate('addToken');
    expect(own.args.tokenId).toBe('1');
    expect(own.args.tempId).toBe(77);
    expect(other.args.tokenId).toBe('1');
    expect(other.from).toBe('host-user');
  });

  it('stops players adding tokens', async () => {
    const { port, server } = await setup();
    const { host, player } = await hostAndPlayer(port);
    player.send({ type: 'update', name: 'addToken', args: { modelId: 'orc', x: 1, y: 0, z: 2 } });
    expect((await player.nextType('error')).message).toContain('host');
    expect(Object.keys(server.rooms.get('r1').state.tokens)).toHaveLength(0);
    // and the host heard nothing
    await sleep(50);
    expect(host.messages.filter((m) => m.type === 'update')).toHaveLength(0);
  });

  it('lets owners (and only owners) move a token', async () => {
    const { port } = await setup();
    const { host, player } = await hostAndPlayer(port);
    host.send({ type: 'update', name: 'addToken', args: { modelId: 'orc', x: 0, y: 0, z: 0 } });
    await player.nextUpdate('addToken');

    const move = { tokenId: '1', x: 5, y: 0, z: 6 };
    player.send({ type: 'update', name: 'updateTokenPosition', args: move });
    expect((await player.nextType('error')).message).toContain('own');

    host.send({
      type: 'update',
      name: 'assignToken',
      args: { tokenId: '1', userId: 'player-user' },
    });
    await player.nextUpdate('assignToken');

    player.send({ type: 'update', name: 'updateTokenPosition', args: move });
    const moved = await host.nextUpdate('updateTokenPosition');
    expect(moved.args).toEqual(move);
    // player may not rescale even their own token
    player.send({
      type: 'update',
      name: 'updateTokenScale',
      args: { tokenId: '1', x: 2, y: 2, z: 2 },
    });
    expect((await player.nextType('error')).message).toContain('host');
  });

  it('applies the other host-only updates and keeps ids unique', async () => {
    const { port, server } = await setup();
    const { host, player } = await hostAndPlayer(port);
    const send = (name: string, args: object) => host.send({ type: 'update', name, args });
    send('addDoor', { x: 1, z: 1, tempId: 'd' });
    send('addPlane', { x: 0, z: 0, planeUploadId: 9, image: 'map.png' });
    send('addWallPoint', { wallGroupId: 3, x: 2, z: 2 });
    send('addToken', { modelId: 1, x: 0, y: 0, z: 0 });
    const door = (await player.nextUpdate('addDoor')).args;
    const plane = (await player.nextUpdate('addPlane')).args;
    const wall = (await player.nextUpdate('addWallPoint')).args;
    const token = (await player.nextUpdate('addToken')).args;
    expect(new Set([door.doorId, plane.planeId, wall.wallPointId, token.tokenId]).size).toBe(4);

    send('updateDoorState', { doorId: door.doorId, open: true });
    send('updateDoorTransform', { doorId: door.doorId, x: 3, z: 4, rotation: 1.5 });
    send('updatePlaneTransform', {
      planeId: plane.planeId,
      x: 1,
      z: 2,
      scaleX: 3,
      scaleY: 4,
      rotation: 5,
    });
    send('updateWallPoint', { wallPointId: wall.wallPointId, x: 9, z: 9 });
    send('updateGridSize', { width: 30, height: 40 });
    send('updateMoonlight', { moonlight: 7 });
    send('updateTokenSettings', { tokenId: token.tokenId, hideAvatar: 1, disableCamLook: false });
    send('updateTokenModel', { tokenId: token.tokenId, modelId: 'elf' });
    await player.next((m) => m.type === 'update' && m.name === 'updateTokenModel');

    const state = server.rooms.get('r1').state;
    expect(state.doors[door.doorId]).toEqual({
      position: { x: 3, z: 4 },
      rotation: 1.5,
      open: true,
    });
    expect(state.planes[plane.planeId].scale).toEqual({ x: 3, y: 4 });
    expect(state.wallPoints[wall.wallPointId].position).toEqual({ x: 9, z: 9 });
    expect(state.grid).toEqual({ width: 30, height: 40 });
    expect(state.tokens[token.tokenId].settings.hideAvatar).toBe(true);
    expect(state.tokens[token.tokenId].modelId).toBe('elf');

    send('removeDoor', { doorId: door.doorId });
    send('removePlane', { planeId: plane.planeId });
    send('removeWallPoint', { wallPointId: wall.wallPointId });
    send('removeToken', { tokenId: token.tokenId });
    await player.next((m) => m.type === 'update' && m.name === 'removeToken');
    expect(Object.keys(state.doors)).toHaveLength(0);
    expect(Object.keys(state.tokens)).toHaveLength(0);
  });

  it('lets everyone ping without persisting, and the sender id cannot be forged', async () => {
    const { port, server } = await setup();
    const { host, player } = await hostAndPlayer(port);
    player.send({ type: 'update', name: 'ping', args: { x: 1, z: 2, userId: 'host-user' } });
    const ping = await host.nextUpdate('ping');
    expect(ping.from).toBe('player-user');
    expect(server.rooms.get('r1').dirty).toBe(false);
  });

  it('assignHost promotes the target, and only hosts may use it', async () => {
    const { port } = await setup();
    const { host, player } = await hostAndPlayer(port);
    player.send({ type: 'update', name: 'assignHost', args: { userId: 'player-user' } });
    await player.nextType('error');

    host.send({ type: 'update', name: 'assignHost', args: { userId: 'player-user' } });
    await player.nextUpdate('assignHost');
    player.send({ type: 'update', name: 'addDoor', args: { x: 1, z: 1 } });
    expect((await host.nextUpdate('addDoor')).from).toBe('player-user');
  });

  it('answers getState requests to the sender only', async () => {
    const { port } = await setup();
    const { host, player } = await hostAndPlayer(port);
    player.send({ type: 'request', name: 'getState', requestId: 'q1' });
    const reply = await player.nextType('response');
    expect(reply).toMatchObject({ name: 'getState', requestId: 'q1' });
    expect(reply.args.state.version).toBe(1);
    await sleep(50);
    expect(host.messages.filter((m) => m.type === 'response')).toHaveLength(0);
  });

  it('keeps rooms isolated', async () => {
    const { port } = await setup();
    const a = await TestClient.join(port, 'a', 'room-a');
    const b = await TestClient.join(port, 'b', 'room-b');
    expect(b.joined.role).toBe('host'); // its own empty room
    a.client.send({ type: 'update', name: 'addToken', args: { modelId: 'x', x: 0, y: 0, z: 0 } });
    await a.client.nextUpdate('addToken');
    await sleep(100);
    expect(b.client.messages.filter((m) => m.type === 'update')).toHaveLength(0);
    b.client.send({ type: 'request', name: 'getState' });
    expect((await b.client.nextType('response')).args.state.tokens).toEqual({});
  });

  it('supports extension handlers', async () => {
    const { port } = await setup({
      handlers: {
        getRooms: (ctx) => ctx.reply({ rooms: [{ id: ctx.room.id }] }),
      },
    });
    const { client } = await TestClient.join(port, 'a', 'r1');
    client.send({ type: 'request', name: 'getRooms' });
    expect((await client.nextType('response')).args.rooms).toEqual([{ id: 'r1' }]);
  });
});

describe('bad input', () => {
  it('rejects bad messages without crashing, and the connection stays usable', async () => {
    const { port } = await setup();
    const { host, player } = await hostAndPlayer(port);
    const bad = [
      { type: 'update', name: 'doesNotExist', args: {} },
      { type: 'update', name: 'constructor', args: {} },
      { type: 'nonsense' },
      { type: 'update', name: 'updateDaylight', args: { daylight: 'bright' } },
      { type: 'update', name: 'updateDaylight', args: { daylight: NaN } },
      { type: 'update', name: 'updateDaylight', args: null },
      { type: 'update', name: 'updateDaylight' },
      { type: 'update', name: 'addToken', args: { modelId: 'x'.repeat(300), x: 0, y: 0, z: 0 } },
      { type: 'update', name: 'addToken', args: { modelId: 'orc', x: 0, y: 0 } },
      { type: 'update', name: 'updateTokenPosition', args: { tokenId: '999', x: 0, y: 0, z: 0 } },
      { type: 'update', name: 'updateGridSize', args: { width: 0, height: 5 } },
      { type: 'update', name: 'getState', args: {} },
      { type: 'request', name: 'ping', args: { x: 1, z: 1 } },
    ];
    for (const message of bad) host.send(message);
    host.socket.send('not json at all');
    host.socket.send(JSON.stringify([1, 2]));
    host.socket.send(Buffer.from([1, 2, 3]));
    await sleep(200);
    expect(host.messages.filter((m) => m.type === 'error').length).toBe(bad.length + 3);

    // The "NaN" case is sent as null by JSON; either way nothing changed and the host works.
    host.send({ type: 'update', name: 'updateDaylight', args: { daylight: 42 } });
    expect((await player.nextUpdate('updateDaylight')).args.daylight).toBe(42);
  });

  it('survives oversized messages (connection is dropped, server lives)', async () => {
    const { port } = await setup();
    const { host } = await hostAndPlayer(port);
    host.socket.send(
      JSON.stringify({ type: 'update', name: 'ping', args: { pad: 'x'.repeat(70000) } }),
    );
    expect(await host.waitForClose()).toBe(1009);
    const other = await TestClient.join(port, 'carol', 'r1');
    expect(other.joined.type).toBe('joined');
  });

  it('rate limits floods', async () => {
    const { port } = await setup();
    const { host, player } = await hostAndPlayer(port);
    for (let i = 0; i < 500; i++) host.send({ type: 'update', name: 'ping', args: { x: 1, z: 1 } });
    const error = await host.nextType('error');
    expect(error.message).toContain('rate');
    await sleep(100);
    expect(player.messages.filter((m) => m.name === 'ping').length).toBeLessThan(300);
  });
});

describe('persistence', () => {
  it('saves once after many moves (debounced)', async () => {
    const storage = new CountingStorage();
    const { port } = await setup({ storage });
    const { host } = await hostAndPlayer(port);
    host.send({ type: 'update', name: 'addToken', args: { modelId: 'orc', x: 0, y: 0, z: 0 } });
    await host.nextUpdate('addToken');
    for (let i = 0; i < 40; i++) {
      host.send({
        type: 'update',
        name: 'updateTokenPosition',
        args: { tokenId: '1', x: i, y: 0, z: 0 },
      });
    }
    await sleep(300);
    expect(storage.saves).toBe(1);
    const saved = await storage.loadRoom('r1');
    expect(saved.tokens['1'].position.x).toBe(39);
  });

  it('saves and unloads when the last connection leaves', async () => {
    const storage = new CountingStorage();
    const { port, server } = await setup({ storage, saveDebounceMs: 60000 });
    const { client } = await TestClient.join(port, 'a', 'r1');
    client.send({ type: 'update', name: 'updateDaylight', args: { daylight: 9 } });
    await sleep(50);
    expect(storage.saves).toBe(0);
    client.close();
    await sleep(200);
    expect(storage.saves).toBe(1);
    expect((await storage.loadRoom('r1')).daylight).toBe(9);
    expect(server.rooms.size).toBe(0);
  });

  it('flushes pending changes on stop()', async () => {
    const storage = new CountingStorage();
    const { port, server } = await setup({ storage, saveDebounceMs: 60000 });
    const { client } = await TestClient.join(port, 'a', 'r1');
    client.send({ type: 'update', name: 'updateDaylight', args: { daylight: 11 } });
    await sleep(50);
    expect(storage.saves).toBe(0);
    await server.stop();
    expect((await storage.loadRoom('r1')).daylight).toBe(11);
    expect(await client.waitForClose()).toBe(1001);
  });

  it('survives a failing save and retries on the next change', async () => {
    const storage = new CountingStorage();
    const { port } = await setup({ storage });
    const { client } = await TestClient.join(port, 'a', 'r1');
    storage.failNext = true;
    client.send({ type: 'update', name: 'updateDaylight', args: { daylight: 1 } });
    await sleep(200);
    expect(storage.saves).toBe(0);
    client.send({ type: 'update', name: 'updateDaylight', args: { daylight: 2 } });
    await sleep(200);
    expect(storage.saves).toBe(1);
    expect((await storage.loadRoom('r1')).daylight).toBe(2);
  });

  it('reloads saved rooms from file storage after a restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabletop-'));
    try {
      const first = await setup({ storage: new FileStorage(dir) });
      const a = await TestClient.join(first.port, 'a', 'r1');
      a.client.send({ type: 'update', name: 'addDoor', args: { x: 4, z: 5 } });
      await a.client.nextUpdate('addDoor');
      await first.server.stop();

      const second = await setup({ storage: new FileStorage(dir) });
      const b = await TestClient.join(second.port, 'a', 'r1');
      expect(b.joined.state.doors['1'].position).toEqual({ x: 4, z: 5 });
      expect(b.joined.state.nextId).toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('http', () => {
  it('serves /health and 404s other paths', async () => {
    const { port } = await setup();
    await TestClient.join(port, 'a', 'r1');
    const health = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as {
      status: string;
      uptime: number;
    };
    expect(health).toMatchObject({ status: 'ok', rooms: 1, connections: 1 });
    expect(typeof health.uptime).toBe('number');
    expect((await fetch(`http://127.0.0.1:${port}/nope`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(404);
  });
});

// WebSocket is imported to make sure `ws` clients and the server agree on the module version.
void WebSocket;

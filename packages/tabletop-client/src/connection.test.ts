/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles for a websocket and loosely typed messages */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveOptions } from './config';
import { backoffDelay, createConnection, Sink } from './connection';
import { fromServerUpdate, stateToRoom, toServer } from './protocol';

// A websocket we control from the test.
class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: any[] = [];
  onopen: any;
  onmessage: any;
  onclose: any;
  onerror: any;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.onopen();
  }
  receive(message: object) {
    this.onmessage({ data: JSON.stringify(message) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose({ code });
  }
  get last() {
    return this.sent[this.sent.length - 1];
  }
}

function makeSink() {
  const calls: { kind: string; name?: string; args?: any }[] = [];
  const sink: Sink = {
    reset: () => calls.push({ kind: 'reset' }),
    update: (name, args) => calls.push({ kind: 'update', name, args }),
    request: (name, args) => calls.push({ kind: 'request', name, args }),
    status: (s) => calls.push({ kind: 'status', name: s.state, args: s }),
    notify: (message) => calls.push({ kind: 'notify', name: message }),
  };
  return { sink, calls, names: () => calls.filter((c) => c.kind === 'update').map((c) => c.name) };
}

const emptyState = (extra: object = {}) => ({
  version: 1,
  name: 'Room',
  grid: { width: 20, height: 20 },
  daylight: 100,
  moonlight: 0,
  nextId: 1,
  tokens: {},
  planes: {},
  doors: {},
  wallPoints: {},
  ...extra,
});

const token = (modelId = 'default-red', x = 1, z = 2) => ({
  modelId,
  position: { x, y: 0, z },
  scale: { x: 1, y: 1, z: 1 },
  owners: [],
  settings: { hideAvatar: false, disableCamLook: false },
});

async function flush() {
  // let the connection's promise chain run
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function setup(extra: object = {}) {
  const { sink, calls, names } = makeSink();
  const options = resolveOptions({
    serverUrl: 'ws://test',
    token: 'me',
    roomId: 'r1',
    WebSocketImpl: FakeSocket,
    ...extra,
  });
  const connection = createConnection(options, sink);
  connection.connect();
  const socket = () => FakeSocket.instances[FakeSocket.instances.length - 1];
  return { connection, calls, names, socket, sink };
}

async function join(s: ReturnType<typeof setup>, state: object = emptyState(), role = 'host') {
  s.socket().open();
  s.socket().receive({
    type: 'joined',
    userId: 'me',
    role,
    state,
    members: [{ userId: 'me', name: 'me', role }],
  });
  await flush();
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('protocol mapping, viewer -> server', () => {
  it('maps plane transforms, wall points, doors and host assignment', () => {
    expect(
      toServer('updatePlaneTransform', {
        planeId: 4,
        posX: 1,
        posZ: 2,
        scaleX: 3,
        scaleY: 4,
        rotZ: 5,
      }),
    ).toEqual({
      name: 'updatePlaneTransform',
      args: { planeId: '4', x: 1, z: 2, scaleX: 3, scaleY: 4, rotation: 5 },
    });
    expect(
      toServer('addWallPoint', { tempWallPointId: 9, wallPointGroupId: 7, x: 1, z: 2 })?.args,
    ).toEqual({
      wallGroupId: '7',
      x: 1,
      z: 2,
      tempId: '9',
    });
    expect(toServer('removeWallPoint', { wallPointGroupId: 7, wallPointId: 3 })).toEqual({
      name: 'removeWallPoint',
      args: { wallPointId: '3' },
    });
    expect(toServer('assignDM', { user_id: 'bob' })).toEqual({
      name: 'assignHost',
      args: { userId: 'bob' },
    });
    expect(toServer('assignToken', { tokenId: 1, user_id: 'bob' })?.args).toEqual({
      tokenId: '1',
      userId: 'bob',
      owned: true,
    });
    expect(toServer('assignToken', { tokenId: 1, user_id: 'bob', owned: false })?.args.owned).toBe(
      false,
    );
    expect(toServer('updateDoorState', { doorId: 1, open: 1 })?.args).toEqual({
      doorId: '1',
      open: true,
    });
    expect(
      toServer('updateTokenSettings', { tokenId: 1, hideAvatar: 1, disableCamLook: 0 })?.args,
    ).toEqual({
      tokenId: '1',
      hideAvatar: true,
      disableCamLook: false,
    });
    expect(toServer('addToken', { x: 1, y: 0, z: 2, modelId: 5, tempTokenId: 'l1' })?.args).toEqual(
      {
        modelId: '5',
        x: 1,
        y: 0,
        z: 2,
        tempId: 'l1',
      },
    );
    expect(
      toServer('addPlane', { x: 1, z: 2, planeUploadId: 3, image: 'a.png', tempPlaneId: 't' })
        ?.args,
    ).toMatchObject({
      planeUploadId: '3',
      image: 'a.png',
      tempId: 't',
    });
    expect(toServer('saveCamera', {})).toBeNull();
    expect(toServer('ping', { x: 1, z: 2, user_id: 'me' })?.args).toEqual({ x: 1, z: 2 });
  });
});

describe('protocol mapping, server -> viewer', () => {
  it('maps every broadcast of the server README', () => {
    const only = (name: string, args: object, from = 'u') => fromServerUpdate(name, args, from)[0];
    expect(
      only('addToken', {
        tokenId: '5',
        tempId: 't',
        modelId: 'm',
        position: { x: 1, y: 2, z: 3 },
        scale: { x: 1, y: 1, z: 1 },
        owners: ['a'],
        settings: {},
      }),
    ).toEqual({
      name: 'addToken',
      args: {
        tokenId: '5',
        tempTokenId: 't',
        modelId: 'm',
        x: 1,
        y: 2,
        z: 3,
        scale: { x: 1, y: 1, z: 1 },
        owners: ['a'],
        settings: {},
      },
    });
    expect(
      only('addPlane', {
        planeId: 2,
        tempId: 't',
        planeUploadId: 'u',
        image: 'i',
        position: { x: 1, z: 2 },
      }).args,
    ).toMatchObject({
      planeId: '2',
      tempPlaneId: 't',
      x: 1,
      z: 2,
    });
    expect(
      only('updatePlaneTransform', { planeId: '2', x: 1, z: 2, scaleX: 3, scaleY: 4, rotation: 5 })
        .args,
    ).toEqual({
      planeId: '2',
      posX: 1,
      posZ: 2,
      scaleX: 3,
      scaleY: 4,
      rotZ: 5,
    });
    expect(
      only('addDoor', {
        doorId: '3',
        tempId: 't',
        position: { x: 1, z: 2 },
        rotation: 0,
        open: false,
      }).args,
    ).toMatchObject({ doorId: '3', open: 0 });
    expect(only('updateDoorState', { doorId: '3', open: true }).args).toEqual({
      doorId: '3',
      open: 1,
    });
    expect(
      only('addWallPoint', {
        wallPointId: '4',
        tempId: 't',
        wallGroupId: 'g',
        position: { x: 1, z: 2 },
      }).args,
    ).toEqual({
      wallPointId: '4',
      tempWallPointId: 't',
      wallPointGroupId: 'g',
      x: 1,
      z: 2,
    });
    expect(only('assignHost', { userId: 'bob' })).toEqual({
      name: 'updateDM',
      args: { user_id: 'bob' },
    });
    expect(
      only('assignToken', { tokenId: '1', userId: 'bob', owned: true, owners: ['bob'] }).args,
    ).toEqual({
      tokenId: '1',
      user_id: 'bob',
      owners: ['bob'],
    });
    expect(only('ping', { x: 1, z: 2 }, 'alice').args).toEqual({
      x: 1,
      z: 2,
      user_id: 'alice',
    });
    expect(
      only('updateTokenSettings', { tokenId: '1', hideAvatar: true, disableCamLook: false }).args,
    ).toEqual({
      tokenId: '1',
      hideAvatar: 1,
      disableCamLook: 0,
    });
    // pass-through events
    expect(only('removeToken', { tokenId: '1' })).toEqual({
      name: 'removeToken',
      args: { tokenId: '1' },
    });
    expect(only('updateGridSize', { width: 3, height: 4 }).args).toEqual({ width: 3, height: 4 });
    expect(only('updateDaylight', { daylight: 1 }).args).toEqual({ daylight: 1 });
  });

  it('builds the room object from a joined state', () => {
    const room = stateToRoom(
      emptyState({ tokens: { '1': token() } }),
      { userId: 'me', role: 'host', name: 'Me' },
      [{ userId: 'me', name: 'Me', role: 'host' }],
      [],
    );
    expect(room.dm).toBe('me');
    expect(room.clients.me.live).toBe(true);
    expect(Object.keys(room.tokens)).toEqual(['1']);
  });
});

describe('backoff', () => {
  it('doubles from 1 s and is capped at 15 s', () => {
    expect([0, 1, 2, 3, 4, 5, 10].map((n) => backoffDelay(n))).toEqual([
      1000, 2000, 4000, 8000, 15000, 15000, 15000,
    ]);
  });
  it('never exceeds the cap with jitter', () => {
    expect(backoffDelay(9, () => 1)).toBe(15000);
    expect(backoffDelay(0, () => 0)).toBe(800);
  });
});

describe('connection', () => {
  it('joins, resolves models and hands the viewer a full room', async () => {
    const s = setup();
    await join(s, emptyState({ tokens: { '1': token('default-blue') } }));
    expect(FakeSocket.instances[0].sent[0]).toEqual({ type: 'join', token: 'me', roomId: 'r1' });
    const joined = s.calls.find((c) => c.name === 'userJoined')!;
    expect(joined.args.user_id).toBe('me');
    expect(joined.args.room.models.map((m: any) => m.id)).toEqual(['default-blue']);
    expect(s.connection.status).toBe('connected');
  });

  it('uses options.resolveModel and falls back when it fails or returns nothing', async () => {
    const resolveModel = vi.fn(async (id: string) => {
      if (id === 'known') return { id, name: 'Goblin', src: 'g.png', baseColor: 0x123456 };
      if (id === 'broken') throw new Error('boom');
      return null;
    });
    const s = setup({ resolveModel });
    await join(
      s,
      emptyState({ tokens: { '1': token('known'), '2': token('broken'), '3': token('nothing') } }),
    );
    const models = s.calls.find((c) => c.name === 'userJoined')!.args.room.models;
    expect(models.find((m: any) => m.id === 'known')).toMatchObject({
      name: 'Goblin',
      src: 'g.png',
      baseColor: 0x123456,
      size: 1,
    });
    expect(models.find((m: any) => m.id === 'broken').src).toBe('');
    expect(models.find((m: any) => m.id === 'nothing').src).toBe('');
  });

  it('defines the model before delivering an addToken from someone else', async () => {
    const s = setup();
    await join(s);
    s.socket().receive({
      type: 'update',
      name: 'addToken',
      from: 'x',
      args: {
        tokenId: '9',
        modelId: 'newmodel',
        position: { x: 1, y: 0, z: 1 },
        scale: { x: 1, y: 1, z: 1 },
        owners: [],
        settings: {},
      },
    });
    await flush();
    const names = s.names();
    expect(names.indexOf('defineModel')).toBeGreaterThan(-1);
    expect(names.indexOf('defineModel')).toBeLessThan(names.indexOf('addToken'));
  });

  it('delivers string and numeric ids alike', async () => {
    const s = setup();
    await join(s);
    s.socket().receive({ type: 'update', name: 'removeToken', args: { tokenId: 12 } });
    s.socket().receive({
      type: 'update',
      name: 'updateTokenPosition',
      args: { tokenId: '12', x: 1, y: 0, z: 2 },
    });
    await flush();
    expect(
      s.calls.filter((c) => c.name === 'removeToken' || c.name === 'updateTokenPosition').length,
    ).toBe(2);
    s.connection.send('update', 'removeToken', { tokenId: 12 });
    expect(s.socket().last.args.tokenId).toBe('12');
  });

  it('translates presence and responses', async () => {
    const s = setup();
    await join(s);
    s.socket().receive({ type: 'presence', event: 'connected', userId: 'bob', name: 'Bob' });
    s.socket().receive({ type: 'presence', event: 'disconnected', userId: 'bob', name: 'Bob' });
    s.socket().receive({
      type: 'response',
      name: 'getRooms',
      args: { rooms: [] },
      requestId: 'r1',
    });
    await flush();
    expect(s.calls.find((c) => c.name === 'clientConnected')!.args).toMatchObject({
      user_id: 'bob',
      name: 'Bob',
    });
    expect(s.calls.find((c) => c.name === 'clientDisconnected')!.args).toEqual({
      user_id: 'bob',
    });
    expect(s.calls.find((c) => c.kind === 'request' && c.name === 'getRooms')).toBeTruthy();
  });

  it('answers getModel locally, without the server', async () => {
    const s = setup();
    await join(s);
    const before = s.socket().sent.length;
    s.connection.send('request', 'getModel', { modelId: 'default-green' });
    await flush();
    expect(s.socket().sent.length).toBe(before);
    expect(s.calls.find((c) => c.kind === 'request' && c.name === 'getModel')!.args.modelId).toBe(
      'default-green',
    );
  });
});

describe('errors and host-app extension points', () => {
  it('turns "unknown event" for getModels into the built-in token list, then answers locally', async () => {
    const s = setup();
    await join(s);
    s.connection.send('request', 'getModels', { parentId: 0, folderId: 0, limit: 24, offset: 0 });
    const sent = s.socket().last;
    expect(sent).toMatchObject({ type: 'request', name: 'getModels' });
    s.socket().receive({
      type: 'error',
      message: 'unknown event',
      name: 'getModels',
      requestId: sent.requestId,
    });
    await flush();
    const reply = s.calls.find((c) => c.kind === 'request' && c.name === 'getModels')!;
    expect(reply.args.models.length).toBeGreaterThan(3);
    expect(reply.args.models[0].src).toBe('');
    // second time no network round trip
    const count = s.socket().sent.length;
    s.connection.send('request', 'getModels', {});
    expect(s.socket().sent.length).toBe(count);
  });

  it('shows a message (no crash) for unsupported host-app events', async () => {
    const s = setup();
    await join(s);
    s.connection.send('request', 'getRooms', {});
    const sent = s.socket().last;
    s.socket().receive({
      type: 'error',
      message: 'unknown event',
      name: 'getRooms',
      requestId: sent.requestId,
    });
    s.connection.send('update', 'focusCamera', { xpos: 1 });
    s.socket().receive({ type: 'error', message: 'unknown event', name: 'focusCamera' });
    await flush();
    const notes = s.calls.filter((c) => c.kind === 'notify').map((c) => c.name);
    expect(notes).toEqual([
      'Room management is not available on this server.',
      "Focusing everyone's camera is not available on this server.",
    ]);
  });

  it('shows server errors such as permission failures as messages', async () => {
    const s = setup();
    await join(s, emptyState(), 'player');
    s.socket().receive({ type: 'error', message: 'only the host can do that', name: 'addToken' });
    await flush();
    expect(s.calls.find((c) => c.kind === 'notify')!.name).toBe('Only the host can do that.');
  });

  it('reports sending while disconnected instead of crashing', async () => {
    const s = setup();
    s.connection.send('update', 'removeToken', { tokenId: 1 });
    expect(s.calls.some((c) => c.kind === 'notify')).toBe(true);
  });
});

describe('creating objects and waiting for their ids', () => {
  it('holds moves of a new token until the server has numbered it, then sends the final one', async () => {
    const s = setup();
    await join(s);
    s.connection.send('update', 'addToken', {
      x: 1,
      y: 0,
      z: 1,
      modelId: 'default-red',
      tempTokenId: 'tmp1',
    });
    const before = s.socket().sent.length;
    s.connection.send('update', 'updateTokenPosition', { tokenId: 'tmp1', x: 2, y: 0, z: 2 });
    s.connection.send('update', 'updateTokenPosition', { tokenId: 'tmp1', x: 3, y: 0, z: 3 });
    expect(s.socket().sent.length).toBe(before);
    s.socket().receive({
      type: 'update',
      name: 'addToken',
      from: 'me',
      args: {
        tokenId: '7',
        tempId: 'tmp1',
        modelId: 'default-red',
        position: { x: 1, y: 0, z: 1 },
        scale: { x: 1, y: 1, z: 1 },
        owners: [],
        settings: {},
      },
    });
    await flush();
    const moves = s.socket().sent.slice(before);
    expect(moves).toEqual([
      { type: 'update', name: 'updateTokenPosition', args: { tokenId: '7', x: 3, y: 0, z: 3 } },
    ]);
  });
});

describe('throttling', () => {
  it('sends at most ~20 messages per second per object and always the last position', async () => {
    const s = setup();
    await join(s);
    const before = s.socket().sent.length;
    for (let i = 0; i < 100; i++) {
      s.connection.send('update', 'updateTokenPosition', { tokenId: '1', x: i, y: 0, z: 0 });
      vi.advanceTimersByTime(10); // 100 messages over one second
    }
    vi.advanceTimersByTime(100);
    const moves = s.socket().sent.slice(before);
    expect(moves.length).toBeLessThanOrEqual(22);
    expect(moves.length).toBeGreaterThan(10);
    expect(moves[moves.length - 1].args.x).toBe(99);
  });

  it('keeps other messages unthrottled and drops pending moves of a removed object', async () => {
    const s = setup();
    await join(s);
    const before = s.socket().sent.length;
    s.connection.send('update', 'updateTokenPosition', { tokenId: '1', x: 1, y: 0, z: 0 });
    s.connection.send('update', 'updateTokenPosition', { tokenId: '1', x: 2, y: 0, z: 0 });
    s.connection.send('update', 'removeToken', { tokenId: '1' });
    vi.advanceTimersByTime(200);
    const names = s
      .socket()
      .sent.slice(before)
      .map((m: any) => m.name);
    expect(names).toEqual(['updateTokenPosition', 'removeToken']);
  });
});

describe('reconnect', () => {
  it('retries with backoff, resets the viewer and rebuilds from the new full state', async () => {
    const s = setup();
    await join(s, emptyState({ tokens: { '1': token() } }));
    expect(s.calls.some((c) => c.kind === 'reset')).toBe(false);

    s.socket().drop();
    expect(s.calls.filter((c) => c.kind === 'status').pop()!.args).toMatchObject({
      state: 'reconnecting',
      delayMs: 1000,
    });
    vi.advanceTimersByTime(999);
    expect(FakeSocket.instances.length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances.length).toBe(2);

    // second attempt fails too: wait 2 s
    s.socket().drop();
    expect(s.calls.filter((c) => c.kind === 'status').pop()!.args.delayMs).toBe(2000);
    vi.advanceTimersByTime(2000);
    expect(FakeSocket.instances.length).toBe(3);

    await join(s, emptyState({ tokens: { '1': token(), '2': token() } }));
    const order = s.calls
      .filter((c) => c.kind === 'reset' || c.name === 'userJoined')
      .map((c) => (c.kind === 'reset' ? 'reset' : 'joined'));
    // first join, then reset before the second join
    expect(order).toEqual(['joined', 'reset', 'joined']);
    expect(s.connection.status).toBe('connected');
    // the delay starts from 1 s again after a successful join
    s.socket().drop();
    expect(s.calls.filter((c) => c.kind === 'status').pop()!.args.delayMs).toBe(1000);
  });

  it('does not retry when the server refuses the login', async () => {
    const s = setup();
    s.socket().open();
    s.socket().receive({ type: 'error', message: 'unauthorized' });
    s.socket().drop(4401);
    vi.advanceTimersByTime(60000);
    expect(FakeSocket.instances.length).toBe(1);
    expect(s.connection.status).toBe('failed');
  });

  it('stops retrying after close()', async () => {
    const s = setup();
    await join(s);
    s.socket().drop();
    s.connection.close();
    vi.advanceTimersByTime(60000);
    expect(FakeSocket.instances.length).toBe(1);
  });

  it('switchRoom joins the other room on a fresh socket', async () => {
    const s = setup();
    await join(s);
    s.connection.switchRoom('r2');
    expect(s.connection.roomId).toBe('r2');
    expect(FakeSocket.instances.length).toBe(2);
    s.socket().open();
    expect(s.socket().sent[0]).toEqual({ type: 'join', token: 'me', roomId: 'r2' });
  });

  it('ignores late messages from an old socket', async () => {
    const s = setup();
    await join(s);
    const old = s.socket();
    old.drop();
    vi.advanceTimersByTime(1000);
    old.receive({ type: 'update', name: 'removeToken', args: { tokenId: '1' } });
    await flush();
    expect(s.calls.some((c) => c.name === 'removeToken')).toBe(false);
  });
});

describe('demo mode', () => {
  it('needs no socket and answers requests itself', async () => {
    const s = setup({ demo: true });
    await flush();
    expect(FakeSocket.instances.length).toBe(0);
    const joined = s.calls.find((c) => c.name === 'userJoined')!;
    expect(joined.args.room.models.length).toBeGreaterThan(0);
    s.connection.send('request', 'getModels', {});
    expect(s.calls.find((c) => c.kind === 'request' && c.name === 'getModels')).toBeTruthy();
    s.connection.send('update', 'updateTokenPosition', { tokenId: '1', x: 1, y: 0, z: 1 }); // ignored
  });
});

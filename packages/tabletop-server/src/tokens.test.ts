/* eslint-disable @typescript-eslint/no-explicit-any -- test helpers deal in loose JSON */
// One token's own settings and its HP and AC.
import { afterEach, describe, expect, it } from 'vitest';
import { TabletopServer } from './server';
import { migrate } from './state';
import { MemoryStorage } from './storage/memory';
import { startTestServer, TestClient } from './testUtils';

let toStop: TabletopServer[] = [];
afterEach(async () => {
  for (const server of toStop) await server.stop();
  toStop = [];
});

async function room(options: any = {}) {
  const storage = options.storage || new MemoryStorage();
  const { server, port } = await startTestServer({ ...options, storage });
  toStop.push(server);
  const host = (await TestClient.join(port, 'host-user', 'r1')).client;
  const player = (await TestClient.join(port, 'player-user', 'r1')).client;
  const send = (name: string, args: object) => host.send({ type: 'update', name, args });
  send('addToken', { modelId: 'goblin', x: 0, y: 0, z: 0 });
  const { args } = await player.nextUpdate('addToken');
  return { server, port, host, player, send, tokenId: args.tokenId, storage };
}

describe('updateTokenOverrides', () => {
  it('stores the fields, tells everyone and survives a rejoin', async () => {
    const { server, port, host, player, send, tokenId } = await room();
    const overrides = {
      name: ' Grik ',
      size: 2,
      scale: 1.5,
      viewDistance: 120,
      baseColor: 0x112233,
      textureRepeat: [1, 2],
      textureOffset: [0, 0.5],
      modelOffset: [-1, 1],
    };
    send('updateTokenOverrides', { tokenId, overrides });
    const stored = { ...overrides, name: 'Grik' };
    expect((await player.nextUpdate('updateTokenOverrides')).args).toEqual({
      tokenId,
      overrides: stored,
    });
    // the sender hears it too: its viewer shows a name only after the server accepted it
    expect((await host.nextUpdate('updateTokenOverrides')).args.overrides).toEqual(stored);
    expect(server.rooms.get('r1').state.tokens[tokenId].overrides).toEqual(stored);
    const again = await TestClient.join(port, 'third-user', 'r1');
    expect(again.joined.state.tokens[tokenId].overrides).toEqual(stored);
  });

  it('none at all goes back to the picture', async () => {
    const { server, player, send, tokenId } = await room();
    send('updateTokenOverrides', { tokenId, overrides: { name: 'Grik' } });
    await player.nextUpdate('updateTokenOverrides');
    send('updateTokenOverrides', { tokenId, overrides: {} });
    await player.nextUpdate('updateTokenOverrides');
    expect('overrides' in server.rooms.get('r1').state.tokens[tokenId]).toBe(false);
  });

  it('players may not, and bad values change nothing', async () => {
    const { server, host, player, send, tokenId } = await room();
    player.send({
      type: 'update',
      name: 'updateTokenOverrides',
      args: { tokenId, overrides: { name: 'Mine' } },
    });
    expect((await player.nextType('error')).message).toMatch(/host/);
    for (const overrides of [
      { size: 0 },
      { viewDistance: 20000 },
      { baseColor: 0x1000000 },
      { baseColor: null },
      { textureRepeat: [1] },
      { name: '' },
      { name: 'x'.repeat(101) },
      'nope',
    ]) {
      send('updateTokenOverrides', { tokenId, overrides });
      await host.nextType('error');
    }
    expect('overrides' in server.rooms.get('r1').state.tokens[tokenId]).toBe(false);
  });

  it('the hosting app can refuse a name', async () => {
    const { server, host, send, tokenId } = await room({
      checkName: (name: string) => (name === 'Rude' ? 'Not that one.' : null),
    });
    send('updateTokenOverrides', { tokenId, overrides: { name: 'Rude' } });
    expect((await host.nextType('error')).message).toBe('Not that one.');
    expect('overrides' in server.rooms.get('r1').state.tokens[tokenId]).toBe(false);
    send('updateTokenOverrides', { tokenId, overrides: { name: 'Kind' } });
    await host.nextUpdate('updateTokenOverrides');
    expect(server.rooms.get('r1').state.tokens[tokenId].overrides).toEqual({ name: 'Kind' });
  });

  it('leaves them alone when settings change', async () => {
    const { server, player, send, tokenId } = await room();
    send('updateTokenOverrides', { tokenId, overrides: { name: 'Grik' } });
    await player.nextUpdate('updateTokenOverrides');
    send('updateTokenSettings', { tokenId, hideAvatar: true, disableCamLook: false });
    await player.nextUpdate('updateTokenSettings');
    expect(server.rooms.get('r1').state.tokens[tokenId].overrides).toEqual({ name: 'Grik' });
  });
});

describe('updateTokenStats', () => {
  it('stores HP and AC and tells the others', async () => {
    const { server, player, send, tokenId } = await room();
    send('updateTokenStats', { tokenId, hp: 7, maxHp: 20, ac: 15 });
    expect((await player.nextUpdate('updateTokenStats')).args).toEqual({
      tokenId,
      hp: 7,
      maxHp: 20,
      ac: 15,
    });
    expect(server.rooms.get('r1').state.tokens[tokenId].stats).toEqual({
      hp: 7,
      maxHp: 20,
      ac: 15,
    });
  });

  it('players may not, and bad values change nothing', async () => {
    const { server, host, player, send, tokenId } = await room();
    player.send({
      type: 'update',
      name: 'updateTokenStats',
      args: { tokenId, hp: 1, maxHp: 1, ac: 1 },
    });
    expect((await player.nextType('error')).message).toMatch(/host/);
    send('updateTokenStats', { tokenId, hp: -1, maxHp: 1, ac: 1 });
    await host.nextType('error');
    send('updateTokenStats', { tokenId, hp: 1.5, maxHp: 1, ac: 1 });
    await host.nextType('error');
    expect('stats' in server.rooms.get('r1').state.tokens[tokenId]).toBe(false);
  });
});

describe('rooms saved before these fields existed', () => {
  it('load unchanged and take the new fields', async () => {
    const storage = new MemoryStorage();
    const saved = {
      version: 1,
      name: 'Old room',
      grid: { width: 20, height: 20 },
      daylight: 100,
      moonlight: 0,
      nextId: 2,
      tokens: {
        '1': {
          modelId: 'goblin',
          position: { x: 1, y: 0, z: 2 },
          scale: { x: 1, y: 1, z: 1 },
          owners: [],
          settings: { hideAvatar: false, disableCamLook: false },
        },
      },
      planes: {},
      doors: {},
      wallPoints: {},
    };
    await storage.saveRoom('r1', saved as any);
    expect(migrate(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    const { server, port } = await startTestServer({ storage });
    toStop.push(server);
    const { client, joined } = await TestClient.join(port, 'host-user', 'r1');
    expect(joined.state.tokens['1']).toEqual(saved.tokens['1']);
    client.send({
      type: 'update',
      name: 'updateTokenStats',
      args: { tokenId: '1', hp: 3, maxHp: 4, ac: 5 },
    });
    await expect
      .poll(() => server.rooms.get('r1').state.tokens['1'].stats)
      .toEqual({
        hp: 3,
        maxHp: 4,
        ac: 5,
      });
  });
});

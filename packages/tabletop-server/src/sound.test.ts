/* eslint-disable @typescript-eslint/no-explicit-any -- test helpers deal in loose JSON */
// The sound a host adds on top of the ambience for everyone in the room: a scene and a music track.
import { afterEach, describe, expect, it } from 'vitest';
import { TabletopServer } from './server';
import { MemoryStorage } from './storage/memory';
import { sleep, startTestServer, TestClient } from './testUtils';

let toStop: TabletopServer[] = [];
afterEach(async () => {
  for (const server of toStop) await server.stop();
  toStop = [];
});

async function room() {
  const storage = new MemoryStorage();
  const { server, port } = await startTestServer({ storage, saveDebounceMs: 10 });
  toStop.push(server);
  const host = (await TestClient.join(port, 'host-user', 'r1')).client;
  const player = (await TestClient.join(port, 'player-user', 'r1')).client;
  const send = (client: TestClient, name: string, args: unknown) =>
    client.send({ type: 'update', name, args });
  return { server, port, host, player, send, storage };
}

describe('sound: scene and music', () => {
  it('a new room has neither', async () => {
    const { port } = await room();
    const third = await TestClient.join(port, 'third-user', 'r1');
    expect('scene' in third.joined.state).toBe(false);
    expect('music' in third.joined.state).toBe(false);
  });

  it('the host sets both, everyone hears it, and a rejoin and a save keep them', async () => {
    const { server, port, host, player, send, storage } = await room();
    send(host, 'updateScene', { scene: 'tavern' });
    expect((await player.nextUpdate('updateScene')).args).toEqual({ scene: 'tavern' });
    send(host, 'updateMusic', { music: 'battle' });
    expect((await player.nextUpdate('updateMusic')).args).toEqual({ music: 'battle' });

    const third = await TestClient.join(port, 'third-user', 'r1');
    expect(third.joined.state.scene).toBe('tavern');
    expect(third.joined.state.music).toBe('battle');
    await sleep(60);
    const saved = await storage.loadRoom('r1');
    expect(saved.scene).toBe('tavern');
    expect(saved.music).toBe('battle');
    expect(server.rooms.get('r1').state.scene).toBe('tavern');
  });

  it('none leaves nothing behind', async () => {
    const { server, host, player, send } = await room();
    send(host, 'updateScene', { scene: 'cave' });
    send(host, 'updateMusic', { music: 'explore' });
    await player.nextUpdate('updateMusic');
    send(host, 'updateScene', { scene: 'none' });
    send(host, 'updateMusic', { music: 'none' });
    await player.next(
      (m: any) => m.type === 'update' && m.name === 'updateMusic' && m.args.music === 'none',
    );
    const state = server.rooms.get('r1').state;
    expect('scene' in state).toBe(false);
    expect('music' in state).toBe(false);
  });

  it('players cannot change them, and bad values are refused', async () => {
    const { server, host, player, send } = await room();
    send(player, 'updateScene', { scene: 'tavern' });
    send(player, 'updateMusic', { music: 'battle' });
    const bad: [string, unknown][] = [
      ['updateScene', { scene: 'disco' }],
      ['updateScene', { scene: 'constructor' }],
      ['updateScene', { scene: 3 }],
      ['updateScene', null],
      ['updateMusic', { music: 'polka' }],
      ['updateMusic', { music: '__proto__' }],
      ['updateMusic', {}],
    ];
    for (const [name, args] of bad) send(host, name, args);
    await sleep(200);
    expect(player.messages.filter((m: any) => m.type === 'error').length).toBe(2);
    expect(host.messages.filter((m: any) => m.type === 'error').length).toBe(bad.length);
    const state = server.rooms.get('r1').state;
    expect('scene' in state).toBe(false);
    expect('music' in state).toBe(false);
    send(host, 'updateScene', { scene: 'forest' });
    expect((await player.nextUpdate('updateScene')).args.scene).toBe('forest');
  });
});

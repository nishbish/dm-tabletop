/* eslint-disable @typescript-eslint/no-explicit-any -- test helpers deal in loose JSON */
// The in-game clock and the weather a host sets for everyone in the room.
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_CLOCK } from './handlers';
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

describe('time and weather', () => {
  it('a new room has neither, so it looks as rooms always did', async () => {
    const { port } = await room();
    const third = await TestClient.join(port, 'third-user', 'r1');
    expect('clock' in third.joined.state).toBe(false);
    expect('weather' in third.joined.state).toBe(false);
  });

  it('the host sets both, everyone hears it, and a rejoin and a save keep them', async () => {
    const { server, port, host, player, send, storage } = await room();
    send(host, 'updateClock', { clock: 1440 + 14 * 60 + 30 });
    expect((await player.nextUpdate('updateClock')).args.clock).toBe(2310);
    send(host, 'updateWeather', { weather: 'rain' });
    expect((await player.nextUpdate('updateWeather')).args.weather).toBe('rain');

    const third = await TestClient.join(port, 'third-user', 'r1');
    expect(third.joined.state.clock).toBe(2310);
    expect(third.joined.state.weather).toBe('rain');
    await sleep(60);
    const saved = await storage.loadRoom('r1');
    expect(saved.clock).toBe(2310);
    expect(saved.weather).toBe('rain');
    expect(server.rooms.get('r1').state.weather).toBe('rain');
  });

  it('clear weather and a null clock leave nothing behind', async () => {
    const { server, host, player, send } = await room();
    send(host, 'updateClock', { clock: 60 });
    send(host, 'updateWeather', { weather: 'snow' });
    await player.nextUpdate('updateWeather');
    send(host, 'updateClock', { clock: null });
    const update = (name: string, match: (a: any) => boolean) =>
      player.next((m) => m.type === 'update' && m.name === name && match(m.args));
    await update('updateClock', (a) => a.clock === null);
    send(host, 'updateWeather', { weather: 'clear' });
    await update('updateWeather', (a) => a.weather === 'clear');
    const state = server.rooms.get('r1').state;
    expect('clock' in state).toBe(false);
    expect('weather' in state).toBe(false);
  });

  it('players cannot change them, and bad values are refused', async () => {
    const { server, host, player, send } = await room();
    send(player, 'updateClock', { clock: 60 });
    send(player, 'updateWeather', { weather: 'rain' });
    const bad: [string, unknown][] = [
      ['updateClock', { clock: -1 }],
      ['updateClock', { clock: MAX_CLOCK + 1 }],
      ['updateClock', { clock: 1.5 }],
      ['updateClock', { clock: '60' }],
      ['updateClock', {}],
      ['updateClock', null],
      ['updateWeather', { weather: 'sharknado' }],
      ['updateWeather', { weather: 'constructor' }],
      ['updateWeather', { weather: 5 }],
    ];
    for (const [name, args] of bad) send(host, name, args);
    await sleep(200);
    expect(player.messages.filter((m: any) => m.type === 'error').length).toBe(2);
    expect(host.messages.filter((m: any) => m.type === 'error').length).toBe(bad.length);
    const state = server.rooms.get('r1').state;
    expect('clock' in state).toBe(false);
    expect('weather' in state).toBe(false);
    // the host still works
    send(host, 'updateClock', { clock: MAX_CLOCK });
    expect((await player.nextUpdate('updateClock')).args.clock).toBe(MAX_CLOCK);
  });
});

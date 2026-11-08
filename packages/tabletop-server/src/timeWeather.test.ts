/* eslint-disable @typescript-eslint/no-explicit-any -- test helpers deal in loose JSON */
// The ambience a host sets for everyone in the room: a time of day and a weather.
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

describe('ambience: time of day and weather', () => {
  it('a new room has neither, so it looks as rooms always did', async () => {
    const { port } = await room();
    const third = await TestClient.join(port, 'third-user', 'r1');
    expect('time' in third.joined.state).toBe(false);
    expect('weather' in third.joined.state).toBe(false);
  });

  it('the host sets both, everyone hears it, and a rejoin and a save keep them', async () => {
    const { server, port, host, player, send, storage } = await room();
    send(host, 'updateTime', { time: 'dusk' });
    expect((await player.nextUpdate('updateTime')).args).toEqual({
      time: 'dusk',
      daylight: 100,
      moonlight: 0,
    });
    send(host, 'updateWeather', { weather: 'rain' });
    expect((await player.nextUpdate('updateWeather')).args.weather).toBe('rain');

    const third = await TestClient.join(port, 'third-user', 'r1');
    expect(third.joined.state.time).toBe('dusk');
    expect(third.joined.state.weather).toBe('rain');
    await sleep(60);
    const saved = await storage.loadRoom('r1');
    expect(saved.time).toBe('dusk');
    expect(saved.weather).toBe('rain');
    expect(server.rooms.get('r1').state.weather).toBe('rain');
  });

  it('night is moonlight without daylight; the old moonlight switch takes the time away', async () => {
    const { server, host, player, send } = await room();
    send(host, 'updateTime', { time: 'night' });
    expect((await player.nextUpdate('updateTime')).args).toEqual({
      time: 'night',
      daylight: 0,
      moonlight: 1,
    });
    const state = server.rooms.get('r1').state;
    expect(state).toMatchObject({ time: 'night', daylight: 0, moonlight: 1 });

    send(host, 'updateMoonlight', { moonlight: 0 });
    await player.nextUpdate('updateMoonlight');
    expect('time' in state).toBe(false);
  });

  it('clear weather leaves nothing behind', async () => {
    const { server, host, player, send } = await room();
    send(host, 'updateWeather', { weather: 'snow' });
    await player.nextUpdate('updateWeather');
    send(host, 'updateWeather', { weather: 'clear' });
    await player.next(
      (m: any) => m.type === 'update' && m.name === 'updateWeather' && m.args.weather === 'clear',
    );
    expect('weather' in server.rooms.get('r1').state).toBe(false);
  });

  it('players cannot change them, and bad values are refused', async () => {
    const { server, host, player, send } = await room();
    send(player, 'updateTime', { time: 'night' });
    send(player, 'updateWeather', { weather: 'rain' });
    const bad: [string, unknown][] = [
      ['updateTime', { time: 'noon' }],
      ['updateTime', { time: 'constructor' }],
      ['updateTime', { time: 1 }],
      ['updateTime', {}],
      ['updateTime', null],
      ['updateWeather', { weather: 'sharknado' }],
      ['updateWeather', { weather: 'constructor' }],
      ['updateWeather', { weather: 5 }],
    ];
    for (const [name, args] of bad) send(host, name, args);
    await sleep(200);
    expect(player.messages.filter((m: any) => m.type === 'error').length).toBe(2);
    expect(host.messages.filter((m: any) => m.type === 'error').length).toBe(bad.length);
    const state = server.rooms.get('r1').state;
    expect('time' in state).toBe(false);
    expect('weather' in state).toBe(false);
    // the host still works
    send(host, 'updateTime', { time: 'dawn' });
    expect((await player.nextUpdate('updateTime')).args.time).toBe('dawn');
  });
});

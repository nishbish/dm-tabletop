// The Web Audio player with a stand-in AudioContext and fetch: what is downloaded when, what plays,
// and that an indoor scene closes the filter.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudio } from './audio.js';
import { defaultSettings } from './sound';

function param(value = 0) {
  const p = {
    value,
    setTargetAtTime: (v: number) => {
      p.value = v;
    },
  };
  return p;
}

function node() {
  return { connect: (n: unknown) => n, disconnect: () => {} };
}

const started: { buffer: unknown; loop: boolean }[] = [];
let contexts = 0;

class FakeContext {
  state = 'running';
  currentTime = 0;
  destination = node();
  constructor() {
    contexts++;
  }
  createGain() {
    return { ...node(), gain: param(1) };
  }
  createBiquadFilter() {
    return { ...node(), type: '', Q: param(), frequency: param(20000) };
  }
  createBufferSource() {
    const source = {
      ...node(),
      buffer: null,
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      playbackRate: param(1),
      onended: null,
      start: () => started.push(source),
      stop: () => {},
    };
    return source;
  }
  decodeAudioData(data: { name: string }, ok: (b: unknown) => void) {
    ok({ duration: 10, name: data.name });
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

const MANIFEST = {
  version: 1,
  files: {
    rain: { src: 'rain.m4a', rate: 32000, length: 10, loop: true },
    night: { src: 'night.m4a', rate: 32000, length: 10, loop: true },
    tavern: { src: 'tavern.m4a', rate: 32000, length: 10, loop: true },
    fire: { src: 'fire.m4a', rate: 32000, length: 10, loop: true },
    'music-battle': { src: 'music-battle.m4a', rate: 44100, length: 10, loop: true },
    effects: { src: 'effects.m4a', rate: 44100, length: 10, clips: { 'dice-1': [0, 1] } },
  },
};

let fetched: string[] = [];

beforeEach(() => {
  started.length = 0;
  contexts = 0;
  fetched = [];
  vi.stubGlobal('window', { AudioContext: FakeContext });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetched.push(url);
      if (url.endsWith('sounds.json')) return { ok: true, json: async () => MANIFEST };
      return { ok: true, arrayBuffer: async () => ({ name: url }) };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the player', () => {
  it('creates and downloads nothing before the first click', async () => {
    const audio = createAudio('/snd/', defaultSettings());
    audio.setRoom({ time: 'night', weather: 'rain', scene: 'tavern', music: 'battle' });
    audio.play('dice');
    await settle();
    expect(contexts).toBe(0);
    expect(fetched).toEqual([]);
    expect(audio.state().running).toBe(false);
    audio.dispose();
  });

  it('after a click, downloads only what the room needs, once each', async () => {
    const audio = createAudio('/snd/', defaultSettings());
    audio.setRoom({ time: 'night', weather: 'clear', scene: 'none', music: 'none' });
    audio.unlock();
    audio.unlock();
    await settle();
    await settle();
    expect(contexts).toBe(1);
    expect(fetched.sort()).toEqual(['/snd/effects.m4a', '/snd/night.m4a', '/snd/sounds.json']);
    expect(audio.state().loops).toEqual(['night']);
    expect(started.filter((s) => s.loop)).toHaveLength(1);
    audio.dispose();
  });

  it('an indoor scene closes the filter, outdoors opens it', async () => {
    const audio = createAudio('/snd/', defaultSettings());
    audio.unlock();
    audio.setRoom({ time: 'day', weather: 'rain', scene: 'tavern' });
    await settle();
    expect(audio.state().loops).toEqual(['fire', 'rain', 'tavern']);
    expect(audio.state().cutoff).toBeLessThan(1000);
    audio.setRoom({ scene: 'forest' });
    expect(audio.state().cutoff).toBe(20000);
    audio.dispose();
  });

  it('switching Ambience off stops its loops, and music has its own switch', async () => {
    const settings = defaultSettings();
    const audio = createAudio('/snd/', settings);
    audio.unlock();
    audio.setRoom({ time: 'night', weather: 'clear', scene: 'none', music: 'battle' });
    await settle();
    expect(audio.state().loops).toEqual(['music-battle', 'night']);
    audio.setSettings({ ...settings, ambience: { on: false, volume: 0.6 } });
    expect(audio.state().loops).toEqual(['music-battle']);
    audio.setSettings({
      ...settings,
      ambience: { on: false, volume: 0.6 },
      music: { on: false, volume: 1 },
    });
    expect(audio.state().loops).toEqual([]);
    audio.dispose();
  });

  it('plays effects only with Effects on', async () => {
    const settings = defaultSettings();
    const audio = createAudio('/snd/', { ...settings, effects: { on: false, volume: 1 } });
    audio.unlock();
    audio.play('dice');
    await settle();
    await settle();
    expect(audio.state().effects).toBe(0);
    audio.setSettings(settings);
    audio.play('dice');
    audio.play('nonsense');
    await settle();
    await settle();
    expect(audio.state().effects).toBe(1);
    audio.dispose();
  });

  it('a missing file is silent and asked for once', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url);
        if (url.endsWith('sounds.json')) return { ok: true, json: async () => MANIFEST };
        return { ok: false, status: 404 };
      }),
    );
    const audio = createAudio('/snd/', { ...defaultSettings(), effects: { on: false, volume: 1 } });
    audio.unlock();
    audio.setRoom({ time: 'night' });
    await settle();
    audio.setRoom({ weather: 'clear' });
    await settle();
    expect(fetched.filter((u) => u.endsWith('night.m4a'))).toHaveLength(1);
    expect(started).toHaveLength(0);
    audio.dispose();
  });
});

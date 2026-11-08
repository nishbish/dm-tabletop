import { describe, expect, it } from 'vitest';
import {
  AAC_PRIMING,
  MUSIC,
  OPEN,
  SCENES,
  ambienceLoops,
  channelGain,
  clipsFor,
  defaultSettings,
  hasThunder,
  loopBounds,
  muffleFor,
  musicFile,
  parseSettings,
  sceneKind,
} from './sound';

const files = (loops: { file: string }[]) => loops.map((l) => l.file).sort();

describe('the presets', () => {
  it('six scenes and four tracks after none, with unknown names falling back to none', () => {
    expect(SCENES.map((s) => s.id)).toEqual([
      'none',
      'tavern',
      'battle',
      'cave',
      'forest',
      'market',
      'dungeon',
    ]);
    expect(MUSIC.map((m) => m.id)).toEqual(['none', 'explore', 'town', 'tavern', 'battle']);
    expect(sceneKind('disco').id).toBe('none');
    expect(sceneKind('constructor').id).toBe('none');
    expect(musicFile('polka')).toBeNull();
    expect(musicFile('none')).toBeNull();
    expect(musicFile('battle')).toBe('music-battle');
  });

  it('marks the indoor scenes, and only they muffle', () => {
    for (const scene of SCENES) {
      expect(!!scene.muffle).toBe(scene.indoors);
    }
    expect(SCENES.filter((s) => s.indoors).map((s) => s.id)).toEqual(['tavern', 'cave', 'dungeon']);
  });
});

describe('the mix', () => {
  it('a clear day with no scene is silent', () => {
    expect(ambienceLoops('day', 'clear', 'none')).toEqual([]);
  });

  it('dawn has birds, night crickets, and weather adds its own loops', () => {
    expect(files(ambienceLoops('dawn', 'clear', 'none'))).toEqual(['dawn']);
    expect(files(ambienceLoops('night', 'clear', 'none'))).toEqual(['night']);
    expect(files(ambienceLoops('day', 'rain', 'none'))).toEqual(['rain']);
    expect(files(ambienceLoops('day', 'storm', 'none'))).toEqual(['storm', 'wind']);
    expect(files(ambienceLoops('night', 'snow', 'none'))).toEqual(['night', 'wind']);
  });

  it('birds and crickets go quiet in the rain', () => {
    const dry = ambienceLoops('dawn', 'clear', 'none')[0].gain;
    const wet = ambienceLoops('dawn', 'rain', 'none').find((l) => l.file === 'dawn').gain;
    expect(wet).toBeLessThan(dry / 2);
  });

  it('weather and time go through the indoor filter; the scene does not', () => {
    const loops = ambienceLoops('night', 'storm', 'tavern');
    expect(files(loops)).toEqual(['fire', 'night', 'storm', 'tavern', 'wind']);
    for (const loop of loops) {
      expect(loop.muffled).toBe(['night', 'storm', 'wind'].includes(loop.file));
    }
  });

  it('a file two layers want plays once, at the louder level', () => {
    const loops = ambienceLoops('day', 'clear', 'dungeon');
    expect(loops.filter((l) => l.file === 'drips')).toHaveLength(1);
    expect(files(loops)).toEqual(['drips', 'dungeon', 'fire']);
  });

  it('indoors muffles, a cave most; outdoors is open', () => {
    expect(muffleFor('none')).toEqual(OPEN);
    expect(muffleFor('forest')).toEqual(OPEN);
    const tavern = muffleFor('tavern');
    const cave = muffleFor('cave');
    expect(tavern.cutoff).toBeLessThan(1000);
    expect(tavern.gain).toBeLessThan(1);
    expect(cave.cutoff).toBeLessThan(tavern.cutoff);
    expect(cave.gain).toBeLessThan(tavern.gain);
  });

  it('thunder only in a storm', () => {
    expect(hasThunder('storm')).toBe(true);
    expect(hasThunder('rain')).toBe(false);
  });

  it('every gain is between 0 and 1', () => {
    for (const time of ['dawn', 'day', 'dusk', 'night']) {
      for (const weather of ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog']) {
        for (const scene of SCENES) {
          for (const loop of ambienceLoops(time, weather, scene.id)) {
            expect(loop.gain).toBeGreaterThan(0);
            expect(loop.gain).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});

describe('the files', () => {
  it('finds the loop when the browser cut the AAC silence off, and after it when not', () => {
    expect(loopBounds(20.5, 20.5, 32000)).toEqual({ start: 0, end: 20.5 });
    // a few samples of padding at the end only
    expect(loopBounds(20.51, 20.5, 32000)).toEqual({ start: 0, end: 20.5 });
    const priming = AAC_PRIMING / 32000;
    const b = loopBounds(20.5 + priming + 0.02, 20.5, 32000);
    expect(b.start).toBeCloseTo(priming, 6);
    expect(b.end).toBeCloseTo(priming + 20.5, 6);
    // no length: the whole file
    expect(loopBounds(9, undefined, undefined)).toEqual({ start: 0, end: 9 });
  });

  it('an effect picks among its numbered clips, in any file', () => {
    const manifest = {
      version: 1,
      files: {
        effects: {
          src: 'e.m4a',
          clips: { 'dice-1': [0, 1], 'dice-2': [1, 1], 'door-open': [2, 1], dicey: [3, 1] },
        },
        thunder: { src: 't.m4a', clips: { thunder: [0, 5] } },
        rain: { src: 'r.m4a', loop: true },
      },
    } as never;
    expect(clipsFor(manifest, 'dice')).toEqual([
      ['effects', 'dice-1'],
      ['effects', 'dice-2'],
    ]);
    expect(clipsFor(manifest, 'thunder')).toEqual([['thunder', 'thunder']]);
    expect(clipsFor(manifest, 'door')).toEqual([]);
    expect(clipsFor(null, 'dice')).toEqual([]);
  });
});

describe('the settings', () => {
  it('reads back what was saved and falls back on anything odd', () => {
    const saved = JSON.stringify({
      ambience: { on: false, volume: 0.25 },
      music: { on: true, volume: 7 },
      effects: { on: 'yes', volume: 'loud' },
    });
    const s = parseSettings(saved);
    expect(s.ambience).toEqual({ on: false, volume: 0.25 });
    expect(s.music.volume).toBe(1);
    expect(s.effects).toEqual(defaultSettings().effects);
    expect(parseSettings('{not json')).toEqual(defaultSettings());
    expect(parseSettings(null)).toEqual(defaultSettings());
  });

  it('off is silent and the slider is squared', () => {
    expect(channelGain({ on: false, volume: 1 })).toBe(0);
    expect(channelGain({ on: true, volume: 0.5 })).toBe(0.25);
  });
});

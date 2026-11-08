import { describe, expect, it } from 'vitest';
import {
  TIMES,
  WEATHERS,
  ambienceText,
  hasDaylight,
  look,
  mixColor,
  multiplyColor,
  roomTime,
  timeKind,
  weatherKind,
} from './time-weather';

const brightness = (c: number) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);

describe('the presets', () => {
  it('four times and six weathers, with unknown names falling back to day and clear', () => {
    expect(TIMES.map((t) => t.id)).toEqual(['dawn', 'day', 'dusk', 'night']);
    expect(WEATHERS.map((w) => w.id)).toEqual(['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog']);
    expect(timeKind('noon').id).toBe('day');
    expect(weatherKind('sharknado').id).toBe('clear');
  });

  it('rooms saved before there were times go by their Moonlight switch', () => {
    expect(roomTime(undefined, 0)).toBe('day');
    expect(roomTime(undefined, 1)).toBe('night');
    expect(roomTime(null, 7)).toBe('night');
    expect(roomTime('dusk', 1)).toBe('dusk');
    expect(roomTime('noon', 0)).toBe('day');
  });

  it('only night takes away daylight', () => {
    expect(TIMES.filter((t) => !hasDaylight(t.id)).map((t) => t.id)).toEqual(['night']);
  });

  it('the card says what is not an ordinary clear day', () => {
    expect(ambienceText('day', 'clear')).toBe('');
    expect(ambienceText('dusk', 'clear')).toBe('Dusk');
    expect(ambienceText('day', 'rain')).toBe('Rain');
    expect(ambienceText('night', 'storm')).toBe('Night · Storm');
  });
});

describe('the look', () => {
  it('a clear day and night are the old daylight and moonlight looks', () => {
    expect(look('day', 'clear')).toMatchObject({
      light: 1,
      lightColor: 0xffffff,
      night: false,
      skyTint: 0xffffff,
      cloudCover: 0,
      cloudOvercast: 0,
    });
    expect(look('night', 'clear')).toMatchObject({
      light: 0.8,
      lightColor: 0x8cb9ff,
      night: true,
      skyTint: 0xffffff,
    });
  });

  it('dawn and dusk are warm and a little dim, with the day sky', () => {
    for (const time of ['dawn', 'dusk']) {
      const l = look(time, 'clear');
      expect(l.night).toBe(false);
      expect(l.light).toBeLessThan(1);
      expect(l.light).toBeGreaterThan(0.8);
      expect((l.lightColor >> 16) & 255).toBeGreaterThan(l.lightColor & 255);
    }
  });

  it('weather dims the light but always leaves the map readable', () => {
    const clear = look('day', 'clear').light;
    for (const w of ['cloudy', 'rain', 'storm', 'snow', 'fog']) {
      const l = look('day', w).light;
      expect(l).toBeLessThan(clear);
      expect(l).toBeGreaterThan(0.6);
      expect(look('night', w).light).toBeGreaterThan(0.5);
    }
    expect(look('night', 'fog').fogColor).toBe(0x2a2f3a);
  });

  it('mixes and multiplies colours channel by channel', () => {
    expect(mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mixColor(0xff0000, 0x0000ff, 1)).toBe(0x0000ff);
    expect(multiplyColor(0x80ff40, 0xffffff)).toBe(0x80ff40);
    expect(multiplyColor(0xffffff, 0x808080)).toBe(0x808080);
  });

  it('clear skies have no clouds; every other weather clouds the sky', () => {
    expect(look('night', 'clear').cloudCover).toBe(0);
    const cloudy = look('day', 'cloudy');
    expect(cloudy.cloudCover).toBeGreaterThan(0.4);
    expect(cloudy.cloudOvercast).toBeLessThan(0.5);
    for (const w of ['rain', 'storm', 'snow', 'fog']) {
      expect(look('day', w).cloudOvercast).toBeGreaterThan(0.8);
    }
  });

  it('cloud colours: storm darkest, snow palest, fog the colour of the fog', () => {
    const lit = (w: string) => brightness(look('day', w).cloudLit);
    expect(lit('storm')).toBeLessThan(lit('rain'));
    expect(lit('rain')).toBeLessThan(lit('snow'));
    expect(lit('snow')).toBeLessThan(lit('cloudy') + 1);
    const fog = look('day', 'fog');
    expect(fog.cloudLit).toBe(fog.fogColor);
    expect(fog.cloudShade).toBe(fog.fogColor);
    // at night the clouds go dim, at dusk they take the sun's warmth
    expect(brightness(look('night', 'cloudy').cloudLit)).toBeLessThan(lit('cloudy') / 3);
    const dusk = look('dusk', 'cloudy').cloudLit;
    expect((dusk >> 16) & 255).toBeGreaterThan(dusk & 255);
  });
});

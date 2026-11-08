import { describe, expect, it } from 'vitest';
import {
  MAX_CLOCK,
  clampClock,
  clockText,
  dayOf,
  isNight,
  look,
  mixColor,
  multiplyColor,
  periodName,
  timeText,
  weatherKind,
} from './time-weather';

const at = (day: number, h: number, m = 0) => (day - 1) * 1440 + h * 60 + m;

describe('the clock in words', () => {
  it('counts days from 1 and shows the time with two digits', () => {
    expect(clockText(0)).toBe('Day 1, 00:00, Night');
    expect(clockText(at(2, 14, 5))).toBe('Day 2, 14:05, Afternoon');
    expect(dayOf(at(3, 23, 59))).toBe(3);
    expect(timeText(at(3, 23, 59))).toBe('23:59');
  });

  it('names the parts of the day', () => {
    expect(periodName(at(1, 6))).toBe('Dawn');
    expect(periodName(at(1, 9))).toBe('Morning');
    expect(periodName(at(1, 12))).toBe('Midday');
    expect(periodName(at(1, 18))).toBe('Dusk');
    expect(periodName(at(1, 21))).toBe('Evening');
    expect(periodName(at(1, 23))).toBe('Night');
  });

  it('keeps a clock to whole minutes inside the range', () => {
    expect(clampClock(-30)).toBe(0);
    expect(clampClock(12.6)).toBe(13);
    expect(clampClock(MAX_CLOCK + 100)).toBe(MAX_CLOCK);
    expect(clampClock(NaN)).toBe(0);
  });

  it('falls back to clear weather for names it does not know', () => {
    expect(weatherKind('rain').label).toBe('Rain');
    expect(weatherKind('sharknado').id).toBe('clear');
  });
});

describe('the look', () => {
  it('without a clock or weather is the old day and moonlight look', () => {
    expect(look(null, 'clear', false)).toMatchObject({
      light: 1,
      lightColor: 0xffffff,
      night: false,
      skyTint: 0xffffff,
    });
    expect(look(null, 'clear', true)).toMatchObject({
      light: 0.8,
      lightColor: 0x8cb9ff,
      night: true,
    });
  });

  it('follows the hour: blue night, bright midday, a warm dusk', () => {
    const night = look(at(1, 2), 'clear', false);
    const noon = look(at(1, 12), 'clear', false);
    const dusk = look(at(1, 18, 30), 'clear', false);
    expect(night).toMatchObject({ night: true, lightColor: 0x8cb9ff, light: 0.8 });
    expect(noon).toMatchObject({ night: false, lightColor: 0xffffff, light: 1.05 });
    expect(dusk.night).toBe(false);
    expect(dusk.lightColor).toBe(0xff9d6b);
    expect(isNight(at(4, 19, 30))).toBe(true);
    expect(isNight(at(4, 6))).toBe(false);
  });

  it('the moonlight switch does nothing once there is a clock', () => {
    expect(look(at(1, 12), 'clear', true)).toEqual(look(at(1, 12), 'clear', false));
  });

  it('moves smoothly: no jump between two minutes', () => {
    for (let m = 0; m < 1440; m += 1) {
      const a = look(m, 'clear', false);
      const b = look(m + 1, 'clear', false);
      expect(Math.abs(a.light - b.light)).toBeLessThan(0.01);
    }
    // midnight joins up with the end of the day before
    expect(look(at(2, 0), 'clear', false)).toEqual(look(at(1, 0), 'clear', false));
  });

  it('weather dims the light but always leaves the map readable', () => {
    const clear = look(at(1, 12), 'clear', false).light;
    for (const w of ['cloudy', 'rain', 'storm', 'snow', 'fog']) {
      const l = look(at(1, 12), w, false).light;
      expect(l).toBeLessThan(clear);
      expect(l).toBeGreaterThan(0.6);
    }
    expect(look(at(1, 2), 'fog', false).fogColor).toBe(0x2a2f3a);
  });

  it('mixes colours channel by channel', () => {
    expect(mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mixColor(0xff0000, 0x0000ff, 1)).toBe(0x0000ff);
    expect(multiplyColor(0x80ff40, 0xffffff)).toBe(0x80ff40);
    expect(multiplyColor(0xffffff, 0x808080)).toBe(0x808080);
  });

  it('clear skies have no clouds; every other weather clouds the sky', () => {
    const clear = look(at(1, 12), 'clear', false);
    expect(clear.cloudCover).toBe(0);
    expect(clear.cloudOvercast).toBe(0);
    expect(look(null, 'clear', true).cloudCover).toBe(0);

    // cloudy: broken clouds with blue between, clearly not clear
    const cloudy = look(at(1, 12), 'cloudy', false);
    expect(cloudy.cloudCover).toBeGreaterThan(0.4);
    expect(cloudy.cloudOvercast).toBeLessThan(0.5);
    for (const w of ['rain', 'storm', 'snow', 'fog']) {
      expect(look(at(1, 12), w, false).cloudOvercast).toBeGreaterThan(0.8);
    }
  });

  it('cloud colours: storm darkest, snow palest, fog the colour of the fog', () => {
    const brightness = (c: number) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
    const lit = (w: string) => brightness(look(at(1, 12), w, false).cloudLit);
    expect(lit('storm')).toBeLessThan(lit('rain'));
    expect(lit('rain')).toBeLessThan(lit('snow'));
    expect(lit('snow')).toBeLessThan(lit('cloudy') + 1);
    const fog = look(at(1, 12), 'fog', false);
    expect(fog.cloudLit).toBe(fog.fogColor);
    expect(fog.cloudShade).toBe(fog.fogColor);
    // at night the clouds go dim, at dusk they take the sun's warmth
    expect(brightness(look(at(1, 2), 'cloudy', false).cloudLit)).toBeLessThan(lit('cloudy') / 3);
    const dusk = look(at(1, 18, 30), 'cloudy', false).cloudLit;
    expect((dusk >> 16) & 255).toBeGreaterThan(dusk & 255);
  });
});

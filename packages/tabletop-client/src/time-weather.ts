// Time of day and weather: the pure part (numbers and words, no three.js), so it can be tested on
// its own. The room's clock counts minutes from midnight at the start of day 1; the server keeps it
// and the weather (tabletop-server's updateClock and updateWeather). weather.js draws the rain,
// snow and fog; tabletop.js uses look() for the light and the sky.

export const MINUTES_PER_DAY = 1440;
// The same limit as the server: the end of day 600.
export const MAX_CLOCK = MINUTES_PER_DAY * 600 - 1;

export interface WeatherKind {
  id: string;
  label: string;
  // a Material Icons ligature
  icon: string;
}

export const WEATHERS: WeatherKind[] = [
  { id: 'clear', label: 'Clear', icon: 'wb_sunny' },
  { id: 'cloudy', label: 'Cloudy', icon: 'cloud' },
  { id: 'rain', label: 'Rain', icon: 'water_drop' },
  { id: 'storm', label: 'Storm', icon: 'thunderstorm' },
  { id: 'snow', label: 'Snow', icon: 'ac_unit' },
  { id: 'fog', label: 'Fog', icon: 'blur_on' },
];

export function weatherKind(id: unknown): WeatherKind {
  return WEATHERS.find((w) => w.id === id) || WEATHERS[0];
}

// A clock from the server or a click, kept to whole minutes inside the allowed range.
export function clampClock(clock: number): number {
  if (!Number.isFinite(clock)) return 0;
  return Math.min(MAX_CLOCK, Math.max(0, Math.round(clock)));
}

export function minuteOfDay(clock: number): number {
  return ((clock % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

export function dayOf(clock: number): number {
  return Math.floor(clock / MINUTES_PER_DAY) + 1;
}

const pad = (n: number) => (n < 10 ? '0' : '') + n;

// "14:05"
export function timeText(clock: number): string {
  const m = minuteOfDay(clock);
  return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
}

// The part of the day, in words a table would use.
export function periodName(clock: number): string {
  const h = minuteOfDay(clock) / 60;
  if (h < 5) return 'Night';
  if (h < 7) return 'Dawn';
  if (h < 11) return 'Morning';
  if (h < 14) return 'Midday';
  if (h < 17.5) return 'Afternoon';
  if (h < 19.5) return 'Dusk';
  if (h < 22) return 'Evening';
  return 'Night';
}

// "Day 2, 14:05, Afternoon"
export function clockText(clock: number): string {
  return 'Day ' + dayOf(clock) + ', ' + timeText(clock) + ', ' + periodName(clock);
}

// ---- the look: how bright and what colour the light is, and which sky shows ----

// [minute of day, light strength (1 = the room's normal light), light colour, sky tint]. The sky
// tint multiplies the sky picture; between 19:15 and 05:45 the night sky shows (see isNight).
type Key = [number, number, number, number];

const KEYS: Key[] = [
  [0, 0.8, 0x8cb9ff, 0xffffff],
  [300, 0.8, 0x8cb9ff, 0xffffff],
  [345, 0.82, 0xa8a8e0, 0x6a5a78],
  [390, 0.9, 0xffb37a, 0xe0a080],
  [480, 1, 0xfff1dc, 0xffffff],
  [720, 1.05, 0xffffff, 0xffffff],
  [1020, 1, 0xfff1dc, 0xffffff],
  [1110, 0.9, 0xff9d6b, 0xe09070],
  [1155, 0.82, 0xa8a8e0, 0x6a5a78],
  [1200, 0.8, 0x8cb9ff, 0xffffff],
  [MINUTES_PER_DAY, 0.8, 0x8cb9ff, 0xffffff],
];

// How weather changes the light: strength, a colour the light and sky are mixed towards, and how
// far. Kept gentle: the map must stay readable in every weather. The rest is the sky's clouds
// (clouds.js): `cover` how much of the sky has clouds, `overcast` a sheet over all of it, `lit` and
// `shade` their bright tops and grey undersides by day, and `wind` how fast they drift.
interface WeatherLook {
  light: number;
  tint: number;
  mix: number;
  sky: number;
  cover: number;
  overcast: number;
  lit: number;
  shade: number;
  wind: number;
}

const WEATHER_LOOK: { [id: string]: WeatherLook } = {
  clear: {
    light: 1,
    tint: 0xffffff,
    mix: 0,
    sky: 0,
    cover: 0,
    overcast: 0,
    lit: 0xffffff,
    shade: 0xffffff,
    wind: 0,
  },
  cloudy: {
    light: 0.82,
    tint: 0xb8bec8,
    mix: 0.3,
    sky: 0.75,
    cover: 0.72,
    overcast: 0.3,
    lit: 0xeef0f4,
    shade: 0x868e9a,
    wind: 0.004,
  },
  rain: {
    light: 0.76,
    tint: 0xa6b0c0,
    mix: 0.4,
    sky: 0.8,
    cover: 1,
    overcast: 0.92,
    lit: 0x9aa1ab,
    shade: 0x5a616c,
    wind: 0.006,
  },
  storm: {
    light: 0.64,
    tint: 0x8a94a8,
    mix: 0.5,
    sky: 0.9,
    cover: 1,
    overcast: 1,
    lit: 0x5e6474,
    shade: 0x262a34,
    wind: 0.012,
  },
  snow: {
    light: 0.92,
    tint: 0xe8eef8,
    mix: 0.35,
    sky: 0.7,
    cover: 1,
    overcast: 0.9,
    lit: 0xe8ebf0,
    shade: 0xb2b8c2,
    wind: 0.003,
  },
  // fog's sky is one even haze in the fog's own colour (set in look())
  fog: {
    light: 0.88,
    tint: 0xd0d4d8,
    mix: 0.4,
    sky: 0.6,
    cover: 1,
    overcast: 1,
    lit: 0,
    shade: 0,
    wind: 0.002,
  },
};

// Clouds at night: dim and a little blue, whatever the weather.
const NIGHT_CLOUD_LIT = 0x343a4a;
const NIGHT_CLOUD_SHADE = 0x161a22;

export function mixColor(a: number, b: number, t: number): number {
  const ch = (c: number, shift: number) => (c >> shift) & 255;
  let out = 0;
  for (const shift of [16, 8, 0]) {
    out |= Math.round(ch(a, shift) + (ch(b, shift) - ch(a, shift)) * t) << shift;
  }
  return out;
}

// Each channel of `a` times that of `b` (white leaves `a` as it is): clouds take the sun's colour.
export function multiplyColor(a: number, b: number): number {
  let out = 0;
  for (const shift of [16, 8, 0]) {
    out |= Math.round((((a >> shift) & 255) * ((b >> shift) & 255)) / 255) << shift;
  }
  return out;
}

export function isNight(clock: number): boolean {
  const m = minuteOfDay(clock);
  return m < 345 || m >= 1155;
}

export interface Look {
  // multiplies the room's normal light strength
  light: number;
  lightColor: number;
  night: boolean;
  skyTint: number;
  // for weather 'fog': the colour the distance fades to
  fogColor: number;
  // the clouds (clouds.js): both 0 = none drawn
  cloudCover: number;
  cloudOvercast: number;
  cloudLit: number;
  cloudShade: number;
  wind: number;
}

// `clock` null = the room has no clock: day, or night when `moonlight` is on, as before.
export function look(clock: number | null, weather: string, moonlight: boolean): Look {
  let light = moonlight ? 0.8 : 1;
  let lightColor = moonlight ? 0x8cb9ff : 0xffffff;
  let skyTint = 0xffffff;
  let night = moonlight;

  if (clock !== null) {
    const m = minuteOfDay(clock);
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1][0] <= m) i += 1;
    const [m0, l0, c0, s0] = KEYS[i];
    const [m1, l1, c1, s1] = KEYS[i + 1];
    const t = m1 === m0 ? 0 : (m - m0) / (m1 - m0);
    light = l0 + (l1 - l0) * t;
    lightColor = mixColor(c0, c1, t);
    skyTint = mixColor(s0, s1, t);
    night = isNight(clock);
  }

  const w = WEATHER_LOOK[weather] || WEATHER_LOOK.clear;
  // between night (0) and full day (1): fog is dark at night, pale by day
  const dayness = Math.min(1, Math.max(0, (light - 0.8) / 0.25));
  const fogColor = night ? 0x2a2f3a : mixColor(0x5a606a, 0xb8bec4, dayness);
  // by day the clouds catch the sun's colour (warm at dawn and dusk); at night they go dim
  const cloudDay = night ? 0 : Math.min(1, dayness * 2);
  const cloud = (day: number, dark: number) =>
    mixColor(dark, multiplyColor(day, lightColor), cloudDay);
  return {
    light: light * w.light,
    lightColor: mixColor(lightColor, w.tint, w.mix),
    night,
    skyTint: mixColor(skyTint, w.tint, w.sky),
    fogColor,
    cloudCover: w.cover,
    cloudOvercast: w.overcast,
    cloudLit: weather === 'fog' ? fogColor : cloud(w.lit, NIGHT_CLOUD_LIT),
    cloudShade: weather === 'fog' ? fogColor : cloud(w.shade, NIGHT_CLOUD_SHADE),
    wind: w.wind,
  };
}

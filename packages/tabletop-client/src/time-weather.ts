// Ambience: the time of day and the weather a host picks for the room, the pure part (names and
// colours, no three.js), so it can be tested on its own. The server keeps both (tabletop-server's
// updateTime and updateWeather); weather.js draws the rain, snow and fog, clouds.js the clouds, and
// tabletop.js uses look() for the light and the sky.

export interface Preset {
  id: string;
  label: string;
  // a Material Icons ligature
  icon: string;
}

export const TIMES: Preset[] = [
  { id: 'dawn', label: 'Dawn', icon: 'wb_twilight' },
  { id: 'day', label: 'Day', icon: 'light_mode' },
  { id: 'dusk', label: 'Dusk', icon: 'brightness_4' },
  { id: 'night', label: 'Night', icon: 'dark_mode' },
];

export const WEATHERS: Preset[] = [
  { id: 'clear', label: 'Clear', icon: 'wb_sunny' },
  { id: 'cloudy', label: 'Cloudy', icon: 'cloud' },
  { id: 'rain', label: 'Rain', icon: 'water_drop' },
  { id: 'storm', label: 'Storm', icon: 'thunderstorm' },
  { id: 'snow', label: 'Snow', icon: 'ac_unit' },
  { id: 'fog', label: 'Fog', icon: 'blur_on' },
];

export function timeKind(id: unknown): Preset {
  return TIMES.find((t) => t.id === id) || TIMES[1];
}

export function weatherKind(id: unknown): Preset {
  return WEATHERS.find((w) => w.id === id) || WEATHERS[0];
}

// The time a room shows. Rooms saved before there were times only have the older Moonlight
// switch: on is night, off is day, so they look exactly as they did.
export function roomTime(time: unknown, moonlight: unknown): string {
  if (TIMES.some((t) => t.id === time)) return time as string;
  return moonlight ? 'night' : 'day';
}

// Whether tokens see as far as their view distance (daylight) or only by their own light: night
// is the only dark time. The server sets the room's `daylight` the same way (updateTime).
export function hasDaylight(time: string): boolean {
  return time !== 'night';
}

// "Dusk · Rain" for the card everyone sees; empty for an ordinary clear day (no card).
export function ambienceText(time: string, weather: string): string {
  const parts: string[] = [];
  if (time !== 'day') parts.push(timeKind(time).label);
  if (weather !== 'clear') parts.push(weatherKind(weather).label);
  return parts.join(' · ');
}

// ---- the look: how bright and what colour the light is, and which sky shows ----

// For each time: light strength (1 = the room's normal light), light colour, a tint that
// multiplies the sky picture, whether the night sky shows, and how much like full day it is (for
// the fog and the clouds). Day and night are the room's old daylight and moonlight looks.
interface TimeLook {
  light: number;
  color: number;
  sky: number;
  night: boolean;
  dayness: number;
}

const TIME_LOOK: { [id: string]: TimeLook } = {
  dawn: { light: 0.9, color: 0xffb37a, sky: 0xe0a080, night: false, dayness: 0.45 },
  day: { light: 1, color: 0xffffff, sky: 0xffffff, night: false, dayness: 1 },
  dusk: { light: 0.9, color: 0xff9d6b, sky: 0xe09070, night: false, dayness: 0.4 },
  night: { light: 0.8, color: 0x8cb9ff, sky: 0xffffff, night: true, dayness: 0 },
};

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

export function look(time: string, weather: string): Look {
  const t = TIME_LOOK[time] || TIME_LOOK.day;
  const w = WEATHER_LOOK[weather] || WEATHER_LOOK.clear;
  // fog is dark at night, pale by day
  const fogColor = t.night ? 0x2a2f3a : mixColor(0x5a606a, 0xb8bec4, t.dayness);
  // by day the clouds catch the sun's colour (warm at dawn and dusk); at night they go dim
  const cloudDay = t.night ? 0 : Math.min(1, t.dayness * 2);
  const cloud = (day: number, dark: number) =>
    mixColor(dark, multiplyColor(day, t.color), cloudDay);
  return {
    light: t.light * w.light,
    lightColor: mixColor(t.color, w.tint, w.mix),
    night: t.night,
    skyTint: mixColor(t.sky, w.tint, w.sky),
    fogColor,
    cloudCover: w.cover,
    cloudOvercast: w.overcast,
    cloudLit: weather === 'fog' ? fogColor : cloud(w.lit, NIGHT_CLOUD_LIT),
    cloudShade: weather === 'fog' ? fogColor : cloud(w.shade, NIGHT_CLOUD_SHADE),
    wind: w.wind,
  };
}

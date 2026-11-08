// Sound: the pure part (names, the mix and the settings, no Web Audio), so it can be tested on its
// own. audio.js plays it. Three layers play at once:
//   - the weather and the time of day (rain, wind, a storm's thunder; birds at dawn, crickets at
//     night), from the room's Ambience presets (time-weather.ts);
//   - a scene the host picks, such as a tavern or a cave. An indoor scene muffles the weather
//     (a low-pass filter and less volume), so a storm heard from inside a tavern is a dull rumble;
//   - one-off effects: dice, doors, tokens, pings.
// Music is a fourth, separate layer. Everyone in the room hears the host's choices; each person
// sets their own volume and on/off for Ambience (weather, time and scene), Music and Effects.
//
// The sound files come from the host app (options.sounds): `sounds.json` in that folder names
// each file (see SoundManifest). A file that is missing just stays silent.

export interface Preset {
  id: string;
  label: string;
  // a Material Icons ligature
  icon: string;
}

export interface Muffle {
  // the low-pass filter's cut-off in Hz, and the volume left (0..1)
  cutoff: number;
  gain: number;
}

export interface Scene extends Preset {
  indoors: boolean;
  // how much an indoor scene muffles the weather and the time of day (none outdoors)
  muffle: Muffle | null;
}

export const SCENES: Scene[] = [
  { id: 'none', label: 'None', icon: 'block', indoors: false, muffle: null },
  {
    id: 'tavern',
    label: 'Tavern',
    icon: 'sports_bar',
    indoors: true,
    muffle: { cutoff: 650, gain: 0.5 },
  },
  { id: 'battle', label: 'Battle', icon: 'sports_martial_arts', indoors: false, muffle: null },
  {
    id: 'cave',
    label: 'Cave',
    icon: 'landscape',
    indoors: true,
    muffle: { cutoff: 250, gain: 0.2 },
  },
  { id: 'forest', label: 'Forest', icon: 'forest', indoors: false, muffle: null },
  { id: 'market', label: 'Market', icon: 'storefront', indoors: false, muffle: null },
  {
    id: 'dungeon',
    label: 'Dungeon',
    icon: 'castle',
    indoors: true,
    muffle: { cutoff: 300, gain: 0.25 },
  },
];

export const MUSIC: Preset[] = [
  { id: 'none', label: 'Off', icon: 'music_off' },
  { id: 'explore', label: 'Explore', icon: 'explore' },
  { id: 'town', label: 'Town', icon: 'holiday_village' },
  { id: 'tavern', label: 'Tavern', icon: 'local_bar' },
  { id: 'battle', label: 'Battle', icon: 'whatshot' },
];

export function sceneKind(id: unknown): Scene {
  return SCENES.find((s) => s.id === id) || SCENES[0];
}

export function musicKind(id: unknown): Preset {
  return MUSIC.find((m) => m.id === id) || MUSIC[0];
}

// ---- the mix ----

// One looping file and how loud it plays (0..1, before the person's own volume). `muffled` loops
// go through the indoor filter: the weather and the time of day are outside.
export interface Loop {
  file: string;
  gain: number;
  muffled: boolean;
}

const TIME_LOOPS: { [id: string]: [string, number][] } = {
  dawn: [['dawn', 0.55]],
  day: [],
  dusk: [['night', 0.2]],
  night: [['night', 0.35]],
};

const WEATHER_LOOPS: { [id: string]: [string, number][] } = {
  clear: [],
  cloudy: [['wind', 0.2]],
  rain: [['rain', 0.7]],
  storm: [
    ['storm', 0.85],
    ['wind', 0.35],
  ],
  snow: [['wind', 0.45]],
  fog: [['wind', 0.12]],
};

// birds and crickets keep quiet while it rains, storms or snows
const WET = ['rain', 'storm', 'snow'];

const SCENE_LOOPS: { [id: string]: [string, number][] } = {
  none: [],
  tavern: [
    ['tavern', 0.7],
    ['fire', 0.3],
  ],
  battle: [['battle', 0.55]],
  cave: [
    ['cave', 0.7],
    ['drips', 0.5],
  ],
  forest: [['forest', 0.85]],
  market: [
    ['market', 0.6],
    ['crowd', 0.3],
  ],
  dungeon: [
    ['dungeon', 0.6],
    ['drips', 0.25],
    ['fire', 0.12],
  ],
};

// The loops for a room's time, weather and scene. A file wanted twice plays once, at the louder
// of the two (a dungeon's torch and a tavern's fire are the same file).
export function ambienceLoops(time: string, weather: string, scene: string): Loop[] {
  const out: { [file: string]: Loop } = {};
  const add = (list: [string, number][], scale: number, muffled: boolean) => {
    for (const [file, gain] of list) {
      const g = gain * scale;
      if (!out[file] || out[file].gain < g) out[file] = { file, gain: g, muffled };
    }
  };
  add(TIME_LOOPS[time] || [], WET.indexOf(weather) !== -1 ? 0.3 : 1, true);
  add(WEATHER_LOOPS[weather] || [], 1, true);
  add(SCENE_LOOPS[sceneKind(scene).id], 1, false);
  return Object.values(out);
}

export function musicFile(id: string): string | null {
  const music = musicKind(id);
  return music.id === 'none' ? null : 'music-' + music.id;
}

// Thunder plays only in a storm, through the indoor filter like the rest of the weather.
export function hasThunder(weather: string): boolean {
  return weather === 'storm';
}

// No filter outdoors: open as far as anyone hears.
export const OPEN: Muffle = { cutoff: 20000, gain: 1 };

export function muffleFor(scene: string): Muffle {
  return sceneKind(scene).muffle || OPEN;
}

// How loud each effect is next to the others (0..1).
export const EFFECTS: { [name: string]: number } = {
  dice: 0.8,
  'door-open': 0.6,
  'door-close': 0.6,
  token: 0.3,
  ping: 0.35,
  thunder: 0.9,
};

// ---- the files (sounds.json) ----

export interface SoundFile {
  src: string;
  // the sound's exact length in seconds and the rate it was made at (see loopBounds)
  length?: number;
  rate?: number;
  // plays over and over
  loop?: boolean;
  // short sounds packed into one file: name -> [start, length] in seconds
  clips?: { [name: string]: [number, number] };
}

export interface SoundManifest {
  version: number;
  files: { [name: string]: SoundFile };
}

// Where the sound sits in a decoded file. Compressed audio (AAC) starts with a little silence that
// most browsers cut off when they decode it, but not all: when the decoded sound is longer than it
// should be by at least that silence (2112 samples, AAC's usual), the sound starts after it. A loop
// plays from `start` to `end`; a clip's offsets are counted from `start`.
export const AAC_PRIMING = 2112;

export function loopBounds(
  duration: number,
  length: number | undefined,
  rate: number | undefined,
): { start: number; end: number } {
  if (!length || length > duration) return { start: 0, end: duration };
  const priming = AAC_PRIMING / (rate || 44100);
  const start = duration - length >= priming - 0.0005 ? priming : 0;
  return { start, end: Math.min(duration, start + length) };
}

// The clips that play for an effect: 'dice' picks among 'dice-1', 'dice-2' and so on, or 'dice'.
export function clipsFor(manifest: SoundManifest | null, name: string): [string, string][] {
  const out: [string, string][] = [];
  if (!manifest || !manifest.files) return out;
  for (const [file, entry] of Object.entries(manifest.files)) {
    if (!entry || !entry.clips) continue;
    for (const clip of Object.keys(entry.clips)) {
      if (
        clip === name ||
        (clip.startsWith(name + '-') && /^\d+$/.test(clip.slice(name.length + 1)))
      ) {
        out.push([file, clip]);
      }
    }
  }
  return out;
}

// ---- each person's settings ----

export interface Channel {
  on: boolean;
  // 0..1
  volume: number;
}

export interface SoundSettings {
  ambience: Channel;
  music: Channel;
  effects: Channel;
}

export const CHANNELS: { id: keyof SoundSettings; label: string; icon: string; help: string }[] = [
  {
    id: 'ambience',
    label: 'Ambience',
    icon: 'forest',
    help: 'Weather, time of day and the scene.',
  },
  { id: 'music', label: 'Music', icon: 'music_note', help: 'The music the host plays.' },
  { id: 'effects', label: 'Effects', icon: 'casino', help: 'Dice, doors, tokens and pings.' },
];

export function defaultSettings(): SoundSettings {
  return {
    ambience: { on: true, volume: 0.6 },
    music: { on: true, volume: 0.4 },
    effects: { on: true, volume: 0.7 },
  };
}

// Settings read back from storage: anything missing or odd falls back to the default.
export function parseSettings(raw: unknown): SoundSettings {
  const out = defaultSettings();
  let data = raw;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return out;
    }
  }
  if (!data || typeof data !== 'object') return out;
  for (const { id } of CHANNELS) {
    const channel = (data as { [key: string]: unknown })[id] as { on?: unknown; volume?: unknown };
    if (!channel || typeof channel !== 'object') continue;
    if (typeof channel.on === 'boolean') out[id].on = channel.on;
    if (typeof channel.volume === 'number' && isFinite(channel.volume)) {
      out[id].volume = Math.min(1, Math.max(0, channel.volume));
    }
  }
  return out;
}

// A slider's position to a gain: squared, so the low half of the slider is not all loud.
export function channelGain(channel: Channel): number {
  return channel.on ? channel.volume * channel.volume : 0;
}

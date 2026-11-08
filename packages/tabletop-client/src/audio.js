// Plays the room's sound with Web Audio (sound.ts has the words, the mix and the settings).
//
//   ambience bus <- the scene's loops
//                <- indoor filter (low-pass) <- outside gain <- the weather and time loops, thunder
//   music bus    <- the music loop
//   effects bus  <- dice, doors, tokens, pings
//
// Light on purpose: nothing is created or downloaded until the person has clicked or pressed a key
// in the viewer (browsers allow no sound before that anyway) and a layer that needs it is on. Each
// file is fetched once, when it is first needed; loops play with the browser's own looping (the
// files are made seamless), so nothing runs on a timer while a scene plays, except a slow check
// for thunder during a storm. Music is freed when it stops; the ambience files are small and stay.
import {
  EFFECTS,
  OPEN,
  ambienceLoops,
  channelGain,
  clipsFor,
  defaultSettings,
  hasThunder,
  loopBounds,
  muffleFor,
  musicFile,
} from './sound';

// seconds a loop takes to fade in or out (setTargetAtTime's time constant is a third of it)
var FADE = 2.5;
var MUSIC_GAIN = 0.7;
// the shortest gap between two of the same effect, in ms (tokens dragged by others send many moves)
var EFFECT_GAP = { token: 250 };
var DEFAULT_GAP = 80;

function joinUrl(base, path) {
  if (!base) {
    return path;
  }
  return base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}

export function createAudio(baseUrl, initialSettings) {
  var ctx = null;
  var bus = null;
  var manifestPromise = null;
  var buffers = {};
  // file -> { gain, target, source, bus, stopping, timer }
  var playing = {};
  var room = { time: 'day', weather: 'clear', scene: 'none', music: 'none' };
  var settings = initialSettings || defaultSettings();
  var disposed = false;
  var lastEffect = {};
  var effectsPlayed = 0;
  var thunderTimer = null;
  var nextThunder = 0;

  function anyOn() {
    return settings.ambience.on || settings.music.on || settings.effects.on;
  }

  function now() {
    return ctx.currentTime;
  }

  // Called from a click or key press: the browser lets audio start from there.
  function unlock() {
    if (disposed || !anyOn()) {
      return;
    }
    if (!ctx) {
      var AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        return;
      }
      try {
        ctx = new AudioContextClass({ latencyHint: 'balanced' });
      } catch {
        return;
      }
      buildBuses();
      if (settings.effects.on) {
        loadClips('dice');
      }
      apply();
    }
    if (ctx.state === 'suspended') {
      ctx.resume().catch(function () {});
    }
  }

  function buildBuses() {
    bus = {
      ambience: ctx.createGain(),
      music: ctx.createGain(),
      effects: ctx.createGain(),
      outside: ctx.createGain(),
      filter: ctx.createBiquadFilter(),
    };
    bus.filter.type = 'lowpass';
    bus.filter.Q.value = 0.5;
    bus.filter.frequency.value = OPEN.cutoff;
    bus.outside.connect(bus.filter);
    bus.filter.connect(bus.ambience);
    bus.ambience.connect(ctx.destination);
    bus.music.connect(ctx.destination);
    bus.effects.connect(ctx.destination);
    setVolumes(0);
  }

  function setVolumes(seconds) {
    var at = now();
    bus.ambience.gain.setTargetAtTime(channelGain(settings.ambience), at, seconds || 0.01);
    bus.music.gain.setTargetAtTime(channelGain(settings.music) * MUSIC_GAIN, at, seconds || 0.01);
    bus.effects.gain.setTargetAtTime(channelGain(settings.effects), at, seconds || 0.01);
  }

  // ---- files ----

  function manifest() {
    if (!manifestPromise) {
      manifestPromise = fetch(joinUrl(baseUrl, 'sounds.json'))
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .catch(function () {
          return null;
        });
    }
    return manifestPromise;
  }

  function decode(data) {
    return new Promise(function (resolve, reject) {
      ctx.decodeAudioData(data, resolve, reject);
    });
  }

  // The decoded file and what sounds.json says about it, or null when it cannot be had (it then
  // stays silent, and is not asked for again).
  function load(file) {
    if (!buffers[file]) {
      buffers[file] = manifest()
        .then(function (m) {
          var info = m && m.files && m.files[file];
          if (!info || typeof info.src !== 'string') {
            return null;
          }
          return fetch(joinUrl(baseUrl, info.src))
            .then(function (r) {
              if (!r.ok) {
                throw new Error(r.status);
              }
              return r.arrayBuffer();
            })
            .then(decode)
            .then(function (buffer) {
              var bounds = loopBounds(buffer.duration, info.length, info.rate);
              return { buffer: buffer, info: info, start: bounds.start, end: bounds.end };
            });
        })
        .catch(function () {
          return null;
        });
    }
    return buffers[file];
  }

  function loadClips(name) {
    return manifest().then(function (m) {
      var clips = clipsFor(m, name);
      if (clips.length) {
        load(clips[0][0]);
      }
      return clips;
    });
  }

  // ---- loops ----

  function startLoop(file, gain, target) {
    var entry = playing[file];
    if (entry) {
      if (entry.bus !== target) {
        entry.gain.disconnect();
        entry.gain.connect(target);
        entry.bus = target;
      }
      entry.target = gain;
      if (entry.stopping) {
        entry.stopping = false;
        clearTimeout(entry.timer);
        if (!entry.source) {
          begin(file, entry);
        }
      }
      if (entry.source) {
        entry.gain.gain.setTargetAtTime(gain, now(), FADE / 3);
      }
      return;
    }

    entry = playing[file] = {
      gain: ctx.createGain(),
      target: gain,
      source: null,
      bus: target,
      stopping: false,
      timer: null,
    };
    entry.gain.gain.value = 0;
    entry.gain.connect(target);
    begin(file, entry);
  }

  // Starts a loop once its file is here, unless it was stopped in the meantime.
  function begin(file, entry) {
    load(file).then(function (sound) {
      if (playing[file] !== entry || entry.stopping || entry.source || !sound || disposed) {
        return;
      }
      var source = ctx.createBufferSource();
      source.buffer = sound.buffer;
      source.loop = true;
      source.loopStart = sound.start;
      source.loopEnd = sound.end;
      source.connect(entry.gain);
      // music from its start; ambience from anywhere, so the same file never sounds the same twice
      var from = file.indexOf('music-') === 0 ? 0 : Math.random() * (sound.end - sound.start);
      source.start(0, sound.start + from);
      entry.source = source;
      entry.gain.gain.setTargetAtTime(entry.target, now(), FADE / 3);
    });
  }

  function stopLoop(file) {
    var entry = playing[file];
    if (!entry || entry.stopping) {
      return;
    }
    entry.stopping = true;
    entry.gain.gain.setTargetAtTime(0, now(), FADE / 4);
    entry.timer = setTimeout(
      function () {
        if (playing[file] !== entry || !entry.stopping) {
          return;
        }
        if (entry.source) {
          entry.source.stop();
          entry.source.disconnect();
        }
        entry.gain.disconnect();
        delete playing[file];
        // music is the biggest sound: let it go until it is played again
        if (file.indexOf('music-') === 0) {
          delete buffers[file];
        }
      },
      FADE * 1000 + 300,
    );
  }

  // Makes what plays match the room and the settings.
  function apply() {
    if (!ctx || disposed) {
      return;
    }
    setVolumes(0.15);

    var muffle = muffleFor(room.scene);
    bus.filter.frequency.setTargetAtTime(muffle.cutoff, now(), 0.5);
    bus.outside.gain.setTargetAtTime(muffle.gain, now(), 0.5);

    var want = {};
    if (settings.ambience.on) {
      for (const loop of ambienceLoops(room.time, room.weather, room.scene)) {
        want[loop.file] = { gain: loop.gain, bus: loop.muffled ? bus.outside : bus.ambience };
      }
    }
    var music = settings.music.on ? musicFile(room.music) : null;
    if (music) {
      want[music] = { gain: 1, bus: bus.music };
    }

    for (const file of Object.keys(playing)) {
      if (!want[file]) {
        stopLoop(file);
      }
    }
    for (const file of Object.keys(want)) {
      startLoop(file, want[file].gain, want[file].bus);
    }

    watchThunder();
  }

  // ---- thunder: after each flash of lightning, and now and then if no lightning is drawn ----

  function stormy() {
    return !!ctx && !disposed && settings.ambience.on && hasThunder(room.weather);
  }

  function watchThunder() {
    if (stormy() && !thunderTimer) {
      nextThunder = Date.now() + 8000 + Math.random() * 8000;
      thunderTimer = setInterval(function () {
        if (Date.now() >= nextThunder) {
          thunder(0);
        }
      }, 4000);
    } else if (!stormy() && thunderTimer) {
      clearInterval(thunderTimer);
      thunderTimer = null;
    }
  }

  function thunder(delay) {
    if (!stormy()) {
      return;
    }
    // the next one only if no lightning comes first (people who ask for less motion get none)
    nextThunder = Date.now() + delay * 1000 + 22000 + Math.random() * 15000;
    playClip('thunder', bus.outside, EFFECTS.thunder, delay, 0.9);
  }

  // ---- one-off sounds ----

  function playClip(name, target, gain, delay, pitchFrom) {
    loadClips(name).then(function (clips) {
      if (!clips.length) {
        return;
      }
      var pick = clips[Math.floor(Math.random() * clips.length)];
      return load(pick[0]).then(function (sound) {
        if (!sound || disposed || !sound.info.clips) {
          return;
        }
        var clip = sound.info.clips[pick[1]];
        var source = ctx.createBufferSource();
        var level = ctx.createGain();
        source.buffer = sound.buffer;
        // a little different every time
        source.playbackRate.value = (pitchFrom || 0.95) + Math.random() * 0.1;
        level.gain.value = gain * (0.85 + Math.random() * 0.15);
        source.connect(level);
        level.connect(target);
        source.onended = function () {
          source.disconnect();
          level.disconnect();
        };
        source.start(now() + (delay || 0), sound.start + clip[0], clip[1]);
        effectsPlayed++;
      });
    });
  }

  function play(name) {
    if (!ctx || disposed || !settings.effects.on || !(name in EFFECTS)) {
      return;
    }
    var t = Date.now();
    if (t - (lastEffect[name] || 0) < (EFFECT_GAP[name] || DEFAULT_GAP)) {
      return;
    }
    lastEffect[name] = t;
    playClip(name, bus.effects, EFFECTS[name], 0);
  }

  return {
    unlock: unlock,
    play: play,
    // a flash of lightning was drawn: thunder follows, a moment later as it would
    lightning: function () {
      if (stormy()) {
        thunder(0.4 + Math.random() * 2);
      }
    },
    setRoom: function (next) {
      room = Object.assign({}, room, next);
      apply();
    },
    setSettings: function (next) {
      settings = next;
      apply();
    },
    // for tests: what is playing
    state: function () {
      return {
        running: !!ctx && ctx.state === 'running',
        loops: Object.keys(playing)
          .filter(function (file) {
            return !playing[file].stopping;
          })
          .sort(),
        cutoff: muffleFor(room.scene).cutoff,
        effects: effectsPlayed,
      };
    },
    dispose: function () {
      disposed = true;
      if (thunderTimer) {
        clearInterval(thunderTimer);
      }
      for (const file of Object.keys(playing)) {
        clearTimeout(playing[file].timer);
      }
      playing = {};
      buffers = {};
      if (ctx) {
        ctx.close().catch(function () {});
      }
    },
  };
}

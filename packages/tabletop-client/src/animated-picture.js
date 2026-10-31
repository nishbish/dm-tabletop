// Plays animated token pictures (GIF, or the animated WebP a host resizes them to). A token first
// shows its picture as a normal still texture; if the file turns out to be animated, one canvas
// texture per file is shared by every token that uses it, so ten goblins cost the same as one.
//
// Browsers without ImageDecoder (Safari, for now) keep the still, which is the first frame.
import * as THREE from 'three';

const MAX_PLAYING = 8; // files playing at once, any others stay still until a slot is free
const MAX_LOADING = 2;
const MIN_FRAME_MS = 66; // about 15 frames per second, each frame is an upload to the graphics card
const DEFAULT_FRAME_MS = 100;

// Is this the start of a file that may hold several frames? Only the first bytes are needed: a GIF
// always may, a WebP says so in the flags of its VP8X header.
export function mayBeAnimated(bytes) {
  function text(from, to) {
    return String.fromCharCode.apply(null, bytes.subarray(from, to));
  }

  if (bytes.length >= 4 && text(0, 4) === 'GIF8') {
    return true;
  }
  return (
    bytes.length >= 21 &&
    text(0, 4) === 'RIFF' &&
    text(8, 16) === 'WEBPVP8X' &&
    (bytes[20] & 0x02) !== 0
  );
}

export function frameDelay(frame) {
  var ms = frame.duration ? frame.duration / 1000 : DEFAULT_FRAME_MS;
  return Math.max(MIN_FRAME_MS, ms);
}

async function readsAsAnimated(url) {
  if (/^data:/i.test(url) && !/^data:image\/(gif|webp)/i.test(url)) {
    return false;
  }

  var response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok || !response.body) {
    return false;
  }

  var reader = response.body.getReader();
  var first = await reader.read();
  reader.cancel();
  return !first.done && mayBeAnimated(first.value);
}

export function createAnimatedPictures() {
  var sources = new Map(); // still url -> source
  var loading = 0;
  var disposed = false;

  // Those still loading count too, or the slots they are about to take would be given away twice.
  function slotsTaken() {
    var count = 0;
    sources.forEach(function (source) {
      if (source.state === 'loading' || source.state === 'playing') {
        count++;
      }
    });
    return count;
  }

  function close(source) {
    source.state = 'closed';
    if (source.next) {
      source.next.close();
      source.next = null;
    }
    if (source.decoder) {
      source.decoder.close();
      source.decoder = null;
    }
    if (source.texture) {
      source.texture.dispose();
      source.texture = null;
    }
  }

  function decodeNext(source) {
    source.index = (source.index + 1) % source.frames;
    source.decoder.decode({ frameIndex: source.index }).then(
      function (result) {
        if (source.state === 'playing') {
          source.next = result.image;
        } else {
          result.image.close();
        }
      },
      function () {
        // a damaged frame: stop on the one that is showing
        if (source.state === 'playing') {
          close(source);
        }
      },
    );
  }

  function show(mesh, source) {
    var still = mesh.material.map;
    if (still === source.texture) {
      return;
    }
    if (still) {
      source.texture.repeat.copy(still.repeat);
      source.texture.offset.copy(still.offset);
      source.texture.wrapS = still.wrapS;
      source.texture.wrapT = still.wrapT;
      still.dispose();
    }
    mesh.material.map = source.texture;
  }

  async function load(source) {
    var url = source.stillUrl;
    if (typeof ImageDecoder === 'undefined' || !(await readsAsAnimated(url))) {
      return null;
    }

    url = source.playUrl;
    var response = await fetch(url, { credentials: 'same-origin' });
    var type = (response.headers.get('content-type') || '').split(';')[0];
    if (!response.ok || !(await ImageDecoder.isTypeSupported(type))) {
      return null;
    }

    var decoder = new ImageDecoder({ data: await response.arrayBuffer(), type: type });
    await decoder.tracks.ready;
    await decoder.completed;
    if (decoder.tracks.selectedTrack.frameCount < 2) {
      decoder.close();
      return null;
    }
    return decoder;
  }

  async function start(source) {
    loading++;
    source.state = 'loading';

    try {
      var decoder = await load(source);
      if (decoder === null) {
        source.state = 'still';
        return;
      }

      var first = await decoder.decode({ frameIndex: 0 });
      if (disposed || source.state !== 'loading') {
        first.image.close();
        decoder.close();
        return;
      }

      var canvas = document.createElement('canvas');
      canvas.width = first.image.displayWidth;
      canvas.height = first.image.displayHeight;
      source.context = canvas.getContext('2d');
      source.context.drawImage(first.image, 0, 0);

      source.decoder = decoder;
      source.frames = decoder.tracks.selectedTrack.frameCount;
      source.index = 0;
      source.nextAt = performance.now() + frameDelay(first.image);
      first.image.close();

      source.texture = new THREE.CanvasTexture(canvas);
      // one upload per frame must stay cheap, so no mipmaps
      source.texture.generateMipmaps = false;
      source.texture.minFilter = THREE.LinearFilter;

      source.state = 'playing';
      source.users.forEach(function (mesh) {
        show(mesh, source);
      });
      decodeNext(source);
    } catch (error) {
      // not playable: the still stays, which is what the browsers without ImageDecoder show too
      console.warn('token animation not played', error);
      if (source.state === 'loading') {
        source.state = 'still';
      }
    } finally {
      loading--;
    }
  }

  function inScene(mesh, scene) {
    var object = mesh;
    while (object.parent) {
      object = object.parent;
    }
    return object === scene;
  }

  return {
    // `stillUrl` is what the mesh shows now; `playUrl` is a smaller copy for playing, or the same.
    add: function (mesh, stillUrl, playUrl) {
      var source = sources.get(stillUrl);
      if (!source) {
        source = { stillUrl, playUrl, state: 'new', users: new Set(), next: null };
        sources.set(stillUrl, source);
      }
      source.users.add(mesh);
      if (source.state === 'playing') {
        show(mesh, source);
      }
    },

    update: function (now, scene) {
      var taken = slotsTaken();

      sources.forEach(function (source, key) {
        source.users.forEach(function (mesh) {
          if (!inScene(mesh, scene)) {
            source.users.delete(mesh);
          }
        });

        if (source.users.size === 0) {
          close(source);
          sources.delete(key);
          return;
        }

        if (source.state === 'new' && taken < MAX_PLAYING && loading < MAX_LOADING) {
          taken++;
          start(source);
        }

        if (source.state === 'playing' && source.next && now >= source.nextAt) {
          var frame = source.next;
          var canvas = source.context.canvas;
          source.next = null;
          source.context.clearRect(0, 0, canvas.width, canvas.height);
          source.context.drawImage(frame, 0, 0, canvas.width, canvas.height);
          source.texture.needsUpdate = true;
          source.nextAt = now + frameDelay(frame);
          frame.close();
          decodeNext(source);
        }
      });
    },

    dispose: function () {
      disposed = true;
      sources.forEach(close);
      sources.clear();
    },
  };
}

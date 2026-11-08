// Clouds in the sky for the weather (time-weather.ts picks how much and what colour).
//
// Kept cheap: one low dome inside the sky box and one small noise picture made once, the first
// time the sky clouds over. The graphics card looks the picture up once per sky pixel, laid out
// on a flat ceiling seen in perspective, so the clouds bunch up towards the horizon like real
// ones. Each frame only a drift and the lightning are handed over; clear skies hide the dome, so
// they cost nothing. Visitors who ask their system for less motion get still clouds (the storm's
// flashes are already off for them in weather.js).

var NOISE_SIZE = 128;

var VERTEX = [
  'varying vec3 vDir;',
  'void main() {',
  '	vDir = position;',
  '	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
  '}',
].join('\n');

var FRAGMENT = [
  'uniform sampler2D uNoise;',
  'uniform vec2 uOffset;',
  'uniform float uCover;',
  'uniform float uOvercast;',
  'uniform float uFlash;',
  'uniform vec3 uLit;',
  'uniform vec3 uShade;',
  'varying vec3 vDir;',
  'void main() {',
  '	vec3 d = normalize(vDir);',
  '	float up = max(d.y, 0.0);',
  // a flat ceiling of cloud: further away (lower in the sky) means smaller and closer together
  '	float n = texture2D(uNoise, d.xz / (up + 0.2) * 0.45 + uOffset).r;',
  '	float a = smoothstep(1.0 - uCover, 1.0 - uCover + 0.3, n);',
  // near the horizon (and below it, where the ceiling is never reached) the clouds run together
  // into one even band
  '	float near = smoothstep(0.0, 0.06, up);',
  '	a = mix(uCover * 0.85, a, near);',
  '	n = mix(0.55, n, near);',
  '	a = max(a, uOvercast);',
  '	vec3 col = mix(uShade, uLit, smoothstep(0.3, 0.85, n));',
  '	col += uFlash * vec3(0.55, 0.6, 0.75);',
  // carried a little below the horizon so an overcast sky has no blue rim
  '	a *= smoothstep(-0.25, 0.0, d.y);',
  '	if (a < 0.01) discard;',
  '	gl_FragColor = vec4(col, a);',
  '}',
].join('\n');

function prefersLessMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

// Soft lumpy noise, 0 to 1, that tiles both ways (so the drift never shows a seam).
function noiseTexture(THREE) {
  var size = NOISE_SIZE;
  var values = new Float32Array(size * size);
  var octaves = [4, 8, 16, 32];
  var weight = 1;

  octaves.forEach(function (cells) {
    var lattice = new Float32Array(cells * cells);
    for (var i = 0; i < lattice.length; i++) {
      lattice[i] = Math.random();
    }
    var step = size / cells;
    for (var y = 0; y < size; y++) {
      var gy = y / step;
      var y0 = Math.floor(gy);
      var ty = gy - y0;
      ty = ty * ty * (3 - 2 * ty);
      var r0 = y0 % cells;
      var r1 = (y0 + 1) % cells;
      for (var x = 0; x < size; x++) {
        var gx = x / step;
        var x0 = Math.floor(gx);
        var tx = gx - x0;
        tx = tx * tx * (3 - 2 * tx);
        var c0 = x0 % cells;
        var c1 = (x0 + 1) % cells;
        var top =
          lattice[r0 * cells + c0] + (lattice[r0 * cells + c1] - lattice[r0 * cells + c0]) * tx;
        var bottom =
          lattice[r1 * cells + c0] + (lattice[r1 * cells + c1] - lattice[r1 * cells + c0]) * tx;
        values[y * size + x] += (top + (bottom - top) * ty) * weight;
      }
    }
    weight *= 0.5;
  });

  // stretched to the full 0 to 1, so "how much of the sky" means the same on every load
  var min = Infinity;
  var max = -Infinity;
  for (var j = 0; j < values.length; j++) {
    min = Math.min(min, values[j]);
    max = Math.max(max, values[j]);
  }
  var data = new Uint8Array(size * size * 4);
  for (var k = 0; k < values.length; k++) {
    var v = Math.round(((values[k] - min) / (max - min || 1)) * 255);
    data[k * 4] = v;
    data[k * 4 + 1] = v;
    data[k * 4 + 2] = v;
    data[k * 4 + 3] = 255;
  }

  var texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  // the far-off clouds near the horizon read from the smaller copies, so they do not shimmer
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// `parent` is the sky box: the dome rides with it (it follows the camera, and the 2D view hides it).
export function createClouds(THREE, parent) {
  var dome = null;
  var wind = 0;
  var last = 0;
  var uniforms = {
    uNoise: { value: null },
    uOffset: { value: new THREE.Vector2(Math.random(), Math.random()) },
    uCover: { value: 0 },
    uOvercast: { value: 0 },
    uFlash: { value: 0 },
    uLit: { value: new THREE.Color() },
    uShade: { value: new THREE.Color() },
  };

  function makeDome() {
    uniforms.uNoise.value = noiseTexture(THREE);
    // the top of a ball and a little below its middle: the box has sides of 1, so 0.45 sits inside
    var geometry = new THREE.SphereGeometry(0.45, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.6);
    // drawn straight after the sky box and before the map (the opaque pass, in renderOrder),
    // blended over the sky; it never tests or writes depth, so it cannot hide anything
    var material = new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.BackSide,
      transparent: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      depthTest: false,
      depthWrite: false,
    });
    var made = new THREE.Mesh(geometry, material);
    made.renderOrder = -999;
    made.frustumCulled = false;
    made.name = 'clouds';
    parent.add(made);
    return made;
  }

  // `sky` from look(): cloudCover and cloudOvercast 0 to 1, cloudLit and cloudShade colours, wind.
  function set(sky) {
    var cover = sky ? sky.cloudCover : 0;
    var overcast = sky ? sky.cloudOvercast : 0;
    if (cover <= 0 && overcast <= 0) {
      if (dome) {
        dome.visible = false;
      }
      return;
    }
    if (!dome) {
      dome = makeDome();
    }
    uniforms.uCover.value = cover;
    uniforms.uOvercast.value = overcast;
    uniforms.uLit.value.setHex(sky.cloudLit);
    uniforms.uShade.value.setHex(sky.cloudShade);
    wind = sky.wind || 0;
    dome.visible = true;
  }

  // Once a frame, with the lightning from weather.js (0 = none).
  function update(now, flash) {
    var dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (!dome || !dome.visible) {
      return;
    }
    uniforms.uFlash.value = flash;
    if (wind && !prefersLessMotion()) {
      var offset = uniforms.uOffset.value;
      offset.x = (offset.x + wind * dt) % 1;
      offset.y = (offset.y + wind * 0.4 * dt) % 1;
    }
  }

  function dispose() {
    if (dome) {
      parent.remove(dome);
      dome.geometry.dispose();
      dome.material.dispose();
      uniforms.uNoise.value.dispose();
      dome = null;
    }
  }

  return {
    set: set,
    update: update,
    dispose: dispose,
    visible: function () {
      return !!(dome && dome.visible);
    },
  };
}

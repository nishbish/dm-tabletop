// Fog of war, drawn as a soft shader instead of a flat black box.
//
// What the viewer already works out stays as it was: when a token is picked, the vision code
// raycasts around it and ends up with a polygon of what it can see. This file turns that polygon
// into three layers, kept on small canvases (about 16 pixels per grid cell, never more than 2048
// pixels a side) that the fog shader reads:
//   visible now   the polygon, blurred so its edge is soft
//   the one before  the previous polygon, so the change fades over about 0.4 s
//   explored      everything that was ever visible in this browser (never sent anywhere: the
//                 server's fog data is untouched)
// The shader draws deep, drifting fog over what was never seen (fully opaque at full strength, so
// unrevealed walls never show through), a thinner, dimmer veil over what was seen before but is
// out of sight now, and nothing over what is visible. Wisps of noise drift across the fog and
// curl into the edge of the vision, so the edge is never a hard outline.
// `material.opacity` still sets how strong the fog is (1 for players, 0.6 for the host's
// translucent view, 0 for the clear view); the rest of the viewer keeps changing it as before.

import * as THREE from 'three';

var FOG_HEIGHT = 1.55;
var MAX_TEXTURE = 2048;
var PIXELS_PER_CELL = 16;
var FADE_SECONDS = 0.4;

var vertexShader = [
  'varying vec2 vUv;',
  'varying vec2 vWorld;',
  'void main() {',
  '	vUv = uv;',
  '	vec4 world = modelMatrix * vec4(position, 1.0);',
  '	vWorld = world.xz;',
  '	gl_Position = projectionMatrix * viewMatrix * world;',
  '}',
].join('\n');

var fragmentShader = [
  'varying vec2 vUv;',
  'varying vec2 vWorld;',
  'uniform sampler2D uVisible;',
  'uniform sampler2D uPrevious;',
  'uniform sampler2D uExplored;',
  'uniform float uMix;',
  'uniform float uTime;',
  'uniform float uStrength;',
  '',
  'float hash(vec2 p) {',
  '	p = fract(p * vec2(123.34, 456.21));',
  '	p += dot(p, p + 45.32);',
  '	return fract(p.x * p.y);',
  '}',
  'float vnoise(vec2 p) {',
  '	vec2 i = floor(p);',
  '	vec2 f = fract(p);',
  '	f = f * f * (3.0 - 2.0 * f);',
  '	float a = hash(i);',
  '	float b = hash(i + vec2(1.0, 0.0));',
  '	float c = hash(i + vec2(0.0, 1.0));',
  '	float d = hash(i + vec2(1.0, 1.0));',
  '	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
  '}',
  'float fbm(vec2 p) {',
  '	float v = 0.0;',
  '	float a = 0.55;',
  '	for (int i = 0; i < 3; i++) {',
  '		v += a * vnoise(p);',
  '		p = p * 2.03 + vec2(17.1, 9.3);',
  '		a *= 0.5;',
  '	}',
  '	return v;',
  '}',
  'void main() {',
  '	float visible = mix(texture2D(uPrevious, vUv).r, texture2D(uVisible, vUv).r, smoothstep(0.0, 1.0, uMix));',
  '	// the memory of explored ground only shows when the fog is translucent (the host\'s view):',
  '	// at full strength a player sees nothing outside what the token sees now',
  '	float explored = smoothstep(0.0, 1.0, max(texture2D(uExplored, vUv).r, visible)) * (1.0 - smoothstep(0.9, 1.0, uStrength));',
  '	// two layers of noise drifting in different directions',
  '	float slow = fbm(vWorld * 0.32 + vec2(uTime * 0.035, uTime * 0.021));',
  '	float fast = fbm(vWorld * 0.85 + vec2(-uTime * 0.06, uTime * 0.03) + 7.3);',
  '	float wisp = slow * 0.65 + fast * 0.35;',
  '	// along the edge of what is visible the wisps push the boundary in and out',
  '	float edge = 4.0 * visible * (1.0 - visible);',
  '	float v = clamp(visible + (wisp - 0.5) * 0.9 * edge, 0.0, 1.0);',
  '	float clear = smoothstep(0.08, 0.92, v);',
  '	// deep fog over the never-seen, a thin dim veil over what was seen before',
  '	// (the never-seen fog is solid: the wisps only change its colour, never let the map through)',
  '	float density = mix(1.0, 0.52, explored);',
  '	float alpha = density * (1.0 - clear);',
  '	alpha *= mix(1.0, 0.9 + 0.1 * smoothstep(0.25, 0.75, wisp), explored);',
  '	vec3 deep = vec3(0.030, 0.043, 0.067);',
  '	vec3 pale = vec3(0.19, 0.24, 0.31);',
  '	vec3 col = mix(deep, pale, smoothstep(0.35, 0.8, wisp) * mix(0.8, 0.35, explored));',
  '	// near the edge the fog glows a little where it is thin',
  '	col += vec3(0.05, 0.07, 0.09) * edge * (1.0 - clear) * (0.5 + wisp);',
  '	gl_FragColor = vec4(col, alpha * uStrength);',
  '}',
].join('\n');

function makeCanvas(width, height) {
  var canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  return canvas;
}

function makeTexture(canvas) {
  var texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  return texture;
}

export function createFog(gridWidth, gridHeight) {
  var fog = {
    width: 0,
    height: 0,
    scale: PIXELS_PER_CELL,
    layers: null,
    mix: 1,
    start: performance.now(),
  };
  var geometry = null;

  var material = new THREE.ShaderMaterial({
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uVisible: { value: null },
      uPrevious: { value: null },
      uExplored: { value: null },
      uMix: { value: 1 },
      uTime: { value: 0 },
      uStrength: { value: 1 },
    },
  });
  material.opacity = 1;

  var mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.name = 'fog';
  mesh.rotation.x = -Math.PI * 0.5;
  mesh.renderOrder = 100;
  mesh.frustumCulled = false;

  function disposeLayers() {
    if (!fog.layers) {
      return;
    }

    fog.layers.forEach(function (layer) {
      layer.texture.dispose();
    });
    fog.layers = null;
  }

  // (Re)builds the plane and the canvases for a grid of this size.
  function setGrid(width, height) {
    fog.width = width;
    fog.height = height;
    fog.scale = Math.max(
      2,
      Math.min(PIXELS_PER_CELL, Math.floor(MAX_TEXTURE / Math.max(width, height, 1))),
    );

    if (geometry) {
      geometry.dispose();
    }
    geometry = new THREE.PlaneGeometry(width, height);
    mesh.geometry = geometry;
    mesh.position.set(width / 2 - 0.5, FOG_HEIGHT, height / 2 - 0.5);

    disposeLayers();
    var w = Math.max(2, Math.round(width * fog.scale));
    var h = Math.max(2, Math.round(height * fog.scale));
    fog.layers = ['visible', 'previous', 'explored'].map(function (name) {
      var canvas = makeCanvas(w, h);
      var texture = makeTexture(canvas);

      return { name: name, canvas: canvas, context: canvas.getContext('2d'), texture: texture };
    });
    material.uniforms.uVisible.value = fog.layers[0].texture;
    material.uniforms.uPrevious.value = fog.layers[1].texture;
    material.uniforms.uExplored.value = fog.layers[2].texture;
    fog.mix = 1;
    clearLayers();
  }

  function layer(name) {
    return fog.layers.filter(function (l) {
      return l.name === name;
    })[0];
  }

  function clearLayer(l) {
    l.context.setTransform(1, 0, 0, 1, 0, 0);
    l.context.clearRect(0, 0, l.canvas.width, l.canvas.height);
    l.context.fillStyle = '#000';
    l.context.fillRect(0, 0, l.canvas.width, l.canvas.height);
    l.texture.needsUpdate = true;
  }

  function clearLayers() {
    fog.layers.forEach(clearLayer);
  }

  // Draws the polygon in white, softly, onto a layer (on top of what is there when `keep`).
  function drawPolygon(l, points, keep) {
    var ctx = l.context;
    var blur = Math.max(1.5, fog.scale * 0.45);

    if (!keep) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, l.canvas.width, l.canvas.height);
    }

    ctx.save();
    if ('filter' in ctx) {
      ctx.filter = 'blur(' + blur.toFixed(1) + 'px)';
    }
    ctx.globalCompositeOperation = keep ? 'lighten' : 'source-over';
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    points.forEach(function (p, i) {
      var x = (p.x + 0.5) * fog.scale;
      var y = (p.z + 0.5) * fog.scale;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    l.texture.needsUpdate = true;
  }

  // The polygon of what the active token sees now: [{x, z}, ...] in grid coordinates.
  function setVision(points) {
    if (!fog.layers) {
      return;
    }

    var visible = layer('visible');
    var previous = layer('previous');

    // what was visible becomes "the one before" and fades out while the new one fades in
    previous.context.globalCompositeOperation = 'source-over';
    previous.context.drawImage(visible.canvas, 0, 0);
    previous.texture.needsUpdate = true;
    fog.mix = 0;

    if (points && points.length > 2) {
      drawPolygon(visible, points, false);
      drawPolygon(layer('explored'), points, true);
    } else {
      clearLayer(visible);
    }
  }

  // Nothing seen yet (a new room, or a reconnect).
  function reset() {
    if (!fog.layers) {
      return;
    }

    clearLayers();
    fog.mix = 1;
  }

  var last = performance.now();

  // Called every frame.
  function update(now) {
    var dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;

    if (fog.mix < 1) {
      fog.mix = Math.min(1, fog.mix + dt / FADE_SECONDS);
    }

    material.uniforms.uMix.value = fog.mix;
    material.uniforms.uTime.value = (now - fog.start) / 1000;
    material.uniforms.uStrength.value = material.opacity;
    mesh.visible = material.opacity > 0.001;
  }

  function dispose() {
    disposeLayers();
    if (geometry) {
      geometry.dispose();
    }
    material.dispose();
  }

  setGrid(gridWidth, gridHeight);

  return {
    mesh: mesh,
    material: material,
    setGrid: setGrid,
    setVision: setVision,
    reset: reset,
    update: update,
    dispose: dispose,
  };
}

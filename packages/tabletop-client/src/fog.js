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
//
// The fog is a slab, not a sheet: besides the top at FOG_HEIGHT it has vertical sides, so it cannot
// be seen under from a low camera. A skirt runs round the edge of the map, and a curtain stands just
// outside the edge of what the token sees now, so looking out of the visible area sideways meets a
// wall of fog instead of the floor and walls under the top. The sides use the same shader: each side
// fragment reads the layers a little way into the fog behind it (`aSample`), so a side is solid
// where that ground is unseen, a veil where it was explored (host's view) and clear where it is
// visible. It is all one mesh in world coordinates, one draw call; the curtains are rebuilt (a quad
// per polygon edge) with each new view.
//
// The camera does not draw anything nearer than its near plane (1 unit), so close to the fog the
// near plane slices the top off and the ground under it would show (zoomed right in, the camera sits
// at y = 2.1, closer than that to the top at 1.55). A cap fixes that, and also the camera being
// inside the fog: a quad laid on the near plane every frame, drawn over everything, that shows the
// same fog wherever the near plane is inside the slab and nothing elsewhere. It is only drawn while
// the near plane dips below the top.
//
// setSimple(true) is for slow devices (the Low graphics setting): the same layers at half the
// resolution, and a shader with no noise, so the fog is a flat, soft-edged shade that costs about
// as much as a textured plane.

import * as THREE from 'three';

var FOG_HEIGHT = 1.55;
var MAX_TEXTURE = 2048;
var PIXELS_PER_CELL = 16;
var SIMPLE_PIXELS_PER_CELL = 8;
var FADE_SECONDS = 0.4;
// the sides reach down below the floor (walls stand on y = -0.5)
var FOG_BOTTOM = -0.6;
// how far outside the edge of the view the curtain stands, and how far further out it looks to
// decide how thick it is there (in grid cells)
var CURTAIN_OFFSET = 0.3;
var SIDE_SAMPLE = 0.4;
// the cap sits just past the near plane (normalised device depth -1 is the near plane itself)
var CAP_DEPTH = -0.999;

var vertexShader = [
  'attribute vec2 aSample;',
  'varying vec3 vWorld;',
  'varying vec2 vSample;',
  'void main() {',
  '	vec4 world = modelMatrix * vec4(position, 1.0);',
  '	vWorld = world.xyz;',
  '	vSample = aSample;',
  '	gl_Position = projectionMatrix * viewMatrix * world;',
  '}',
].join('\n');

var fragmentShader = [
  'varying vec3 vWorld;',
  'varying vec2 vSample;',
  'uniform vec2 uGrid;',
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
  '	// the top has no sample offset; a side reads the ground a little way into the fog behind it',
  '	float side = step(0.0001, dot(vSample, vSample));',
  '	vec2 at = vWorld.xz + vSample;',
  '	// grid cell centres are whole numbers, the map starts half a cell before cell 0',
  '	vec2 vUv = vec2((at.x + 0.5) / uGrid.x, 1.0 - (at.y + 0.5) / uGrid.y);',
  '#ifdef FOG_CAP',
  '	// the cap only shows where the near plane is inside the slab over the map',
  '	if (vWorld.y > ' +
    FOG_HEIGHT.toFixed(3) +
    ' || vWorld.y < ' +
    FOG_BOTTOM.toFixed(3) +
    ' || at.x < -0.5 || at.y < -0.5 || at.x > uGrid.x - 0.5 || at.y > uGrid.y - 0.5) discard;',
  '#endif',
  '	float visible = mix(texture2D(uPrevious, vUv).r, texture2D(uVisible, vUv).r, smoothstep(0.0, 1.0, uMix));',
  "	// the memory of explored ground only shows when the fog is translucent (the host's view):",
  '	// at full strength a player sees nothing outside what the token sees now',
  '	float explored = smoothstep(0.0, 1.0, max(texture2D(uExplored, vUv).r, visible)) * (1.0 - smoothstep(0.9, 1.0, uStrength));',
  '#ifdef FOG_SIMPLE',
  '	// flat fog: no noise, no glow, the soft edge comes from the blurred layers alone',
  '	float clear = smoothstep(0.08, 0.92, visible);',
  '	float alpha = mix(1.0, 0.52, explored) * (1.0 - clear);',
  '	vec3 col = mix(vec3(0.030, 0.043, 0.067), vec3(0.11, 0.14, 0.18), 0.5 * explored);',
  '#else',
  '	// two layers of noise drifting in different directions',
  '	// (on a side the noise runs along the side and up it, so it drifts across the face)',
  '	vec2 across = vSample / max(length(vSample), 0.0001);',
  '	vec2 np = mix(vWorld.xz, vec2(dot(vWorld.xz, vec2(-across.y, across.x)), vWorld.y * 1.4), side);',
  '	float slow = fbm(np * 0.32 + vec2(uTime * 0.035, uTime * 0.021));',
  '	float fast = fbm(np * 0.85 + vec2(-uTime * 0.06, uTime * 0.03) + 7.3);',
  '	float wisp = slow * 0.65 + fast * 0.35;',
  '	// along the edge of what is visible the wisps push the boundary in and out (on the top only)',
  '	float edge = 4.0 * visible * (1.0 - visible) * (1.0 - side);',
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
  '#endif',
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
    simple: false,
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
    defines: {},
    uniforms: {
      uVisible: { value: null },
      uPrevious: { value: null },
      uExplored: { value: null },
      uMix: { value: 1 },
      uTime: { value: 0 },
      uStrength: { value: 1 },
      uGrid: { value: new THREE.Vector2(1, 1) },
    },
  });
  material.opacity = 1;

  var mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.name = 'fog';
  mesh.renderOrder = 100;
  mesh.frustumCulled = false;

  // the cap (see the top of the file): a child of the fog, so it hides with it; same uniforms
  var capMaterial = new THREE.ShaderMaterial({
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    defines: { FOG_CAP: '' },
    uniforms: material.uniforms,
  });
  var capGeometry = new THREE.BufferGeometry();
  capGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Array(12).fill(0), 3));
  capGeometry.setAttribute('aSample', new THREE.Float32BufferAttribute(new Array(8).fill(0), 2));
  capGeometry.setIndex([0, 1, 2, 0, 2, 3]);
  var cap = new THREE.Mesh(capGeometry, capMaterial);
  cap.name = 'fog cap';
  cap.renderOrder = 101;
  cap.frustumCulled = false;
  cap.visible = false;
  mesh.add(cap);
  var capCorners = [
    [-1.01, -1.01],
    [1.01, -1.01],
    [1.01, 1.01],
    [-1.01, 1.01],
  ];
  var corner = new THREE.Vector3();

  // Lays the cap on the camera's near plane; shown only when some of it is below the top.
  function placeCap(camera) {
    cap.visible = false;
    if (!camera || !camera.projectionMatrixInverse) {
      return;
    }

    camera.updateMatrixWorld();
    var position = capGeometry.getAttribute('position');
    var lowest = Infinity;
    capCorners.forEach(function (c, i) {
      corner
        .set(c[0], c[1], CAP_DEPTH)
        .applyMatrix4(camera.projectionMatrixInverse)
        .applyMatrix4(camera.matrixWorld);
      position.setXYZ(i, corner.x, corner.y, corner.z);
      lowest = Math.min(lowest, corner.y);
    });
    position.needsUpdate = true;
    cap.visible = lowest < FOG_HEIGHT;
  }

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

    material.uniforms.uGrid.value.set(Math.max(1, width), Math.max(1, height));
    buildGeometry(null);

    disposeLayers();
    makeLayers();
    fog.mix = 1;
    clearLayers();
  }

  // The top, the skirt round the map and (for a view polygon) its curtains, as one geometry in
  // world coordinates. `aSample` is where each fragment reads the layers, relative to itself.
  function buildGeometry(points) {
    var positions = [];
    var samples = [];
    var x0 = -0.5;
    var z0 = -0.5;
    var x1 = fog.width - 0.5;
    var z1 = fog.height - 0.5;

    function vertex(x, y, z, sx, sz) {
      positions.push(x, y, z);
      samples.push(sx, sz);
    }

    // a vertical quad from (ax, az) to (bx, bz), reading the layers at (sx, sz) from itself
    function side(ax, az, bx, bz, sx, sz) {
      vertex(ax, FOG_BOTTOM, az, sx, sz);
      vertex(bx, FOG_BOTTOM, bz, sx, sz);
      vertex(bx, FOG_HEIGHT, bz, sx, sz);
      vertex(ax, FOG_BOTTOM, az, sx, sz);
      vertex(bx, FOG_HEIGHT, bz, sx, sz);
      vertex(ax, FOG_HEIGHT, az, sx, sz);
    }

    // the skirt, reading the ground just inside the map
    side(x0, z0, x1, z0, 0, SIDE_SAMPLE);
    side(x1, z0, x1, z1, -SIDE_SAMPLE, 0);
    side(x1, z1, x0, z1, 0, -SIDE_SAMPLE);
    side(x0, z1, x0, z0, SIDE_SAMPLE, 0);

    curtains(points, function (ax, az, bx, bz, nx, nz) {
      side(ax, az, bx, bz, nx * SIDE_SAMPLE, nz * SIDE_SAMPLE);
    });

    // the top, last: the fog writes no depth, so triangles blend in buffer order, and the camera
    // is always above the top (orbit controls keep it at y >= 2.1), so the top is always in front
    vertex(x0, FOG_HEIGHT, z0, 0, 0);
    vertex(x0, FOG_HEIGHT, z1, 0, 0);
    vertex(x1, FOG_HEIGHT, z1, 0, 0);
    vertex(x0, FOG_HEIGHT, z0, 0, 0);
    vertex(x1, FOG_HEIGHT, z1, 0, 0);
    vertex(x1, FOG_HEIGHT, z0, 0, 0);

    var next = new THREE.BufferGeometry();
    next.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    next.setAttribute('aSample', new THREE.Float32BufferAttribute(samples, 2));
    if (geometry) {
      geometry.dispose();
    }
    geometry = next;
    mesh.geometry = geometry;
  }

  // One curtain per edge of the view polygon, moved CURTAIN_OFFSET outwards (so it stands behind a
  // wall the token sees, not in its face) and stretched by as much at both ends, so the corners
  // leave no gaps. Edges along the edge of the map are left to the skirt.
  function curtains(points, add) {
    if (!points || points.length < 3) {
      return;
    }

    var area = 0;
    points.forEach(function (p, i) {
      var q = points[(i + 1) % points.length];
      area += p.x * q.z - q.x * p.z;
    });
    var turn = area >= 0 ? 1 : -1;

    function onEdge(p) {
      var e = 0.05;
      return (
        p.x <= -0.5 + e ||
        p.z <= -0.5 + e ||
        p.x >= fog.width - 0.5 - e ||
        p.z >= fog.height - 0.5 - e
      );
    }

    points.forEach(function (a, i) {
      var b = points[(i + 1) % points.length];
      var dx = b.x - a.x;
      var dz = b.z - a.z;
      var length = Math.sqrt(dx * dx + dz * dz);

      if (length < 1e-6 || (onEdge(a) && onEdge(b))) {
        return;
      }

      var ux = dx / length;
      var uz = dz / length;
      // outwards: to the right of the edge when the polygon winds anticlockwise (x right, z up)
      var nx = uz * turn;
      var nz = -ux * turn;
      var ox = nx * CURTAIN_OFFSET;
      var oz = nz * CURTAIN_OFFSET;
      var ex = ux * CURTAIN_OFFSET;
      var ez = uz * CURTAIN_OFFSET;
      add(a.x + ox - ex, a.z + oz - ez, b.x + ox + ex, b.z + oz + ez, nx, nz);
    });
  }

  function cellPixels() {
    var wanted = fog.simple ? SIMPLE_PIXELS_PER_CELL : PIXELS_PER_CELL;

    return Math.max(
      2,
      Math.min(wanted, Math.floor(MAX_TEXTURE / Math.max(fog.width, fog.height, 1))),
    );
  }

  function makeLayers() {
    fog.scale = cellPixels();
    var w = Math.max(2, Math.round(fog.width * fog.scale));
    var h = Math.max(2, Math.round(fog.height * fog.scale));
    fog.layers = ['visible', 'previous', 'explored'].map(function (name) {
      var canvas = makeCanvas(w, h);
      var texture = makeTexture(canvas);

      return { name: name, canvas: canvas, context: canvas.getContext('2d'), texture: texture };
    });
    material.uniforms.uVisible.value = fog.layers[0].texture;
    material.uniforms.uPrevious.value = fog.layers[1].texture;
    material.uniforms.uExplored.value = fog.layers[2].texture;
  }

  // Switches between the soft, drifting fog and the cheap flat one. What was seen is kept: the
  // layers are copied to the new resolution.
  function setSimple(simple) {
    simple = !!simple;
    if (simple === fog.simple) {
      return;
    }

    fog.simple = simple;
    [material, capMaterial].forEach(function (m) {
      if (simple) {
        m.defines.FOG_SIMPLE = '';
      } else {
        delete m.defines.FOG_SIMPLE;
      }
      m.needsUpdate = true;
    });

    if (!fog.layers || cellPixels() === fog.scale) {
      return;
    }

    var old = fog.layers;
    makeLayers();
    fog.layers.forEach(function (l, i) {
      l.context.drawImage(old[i].canvas, 0, 0, l.canvas.width, l.canvas.height);
      l.texture.needsUpdate = true;
    });
    old.forEach(function (l) {
      l.texture.dispose();
    });
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
    buildGeometry(points);
  }

  // Nothing seen yet (a new room, or a reconnect).
  function reset() {
    if (!fog.layers) {
      return;
    }

    clearLayers();
    fog.mix = 1;
    buildGeometry(null);
  }

  var last = performance.now();

  // Called every frame, after the camera has moved for this frame.
  function update(now, camera) {
    var dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;

    if (fog.mix < 1) {
      fog.mix = Math.min(1, fog.mix + dt / FADE_SECONDS);
    }

    material.uniforms.uMix.value = fog.mix;
    material.uniforms.uTime.value = (now - fog.start) / 1000;
    material.uniforms.uStrength.value = material.opacity;
    mesh.visible = material.opacity > 0.001;
    if (mesh.visible) {
      placeCap(camera);
    }
  }

  function dispose() {
    disposeLayers();
    if (geometry) {
      geometry.dispose();
    }
    material.dispose();
    capGeometry.dispose();
    capMaterial.dispose();
  }

  setGrid(gridWidth, gridHeight);

  return {
    mesh: mesh,
    material: material,
    cap: cap,
    setGrid: setGrid,
    setVision: setVision,
    setSimple: setSimple,
    reset: reset,
    update: update,
    dispose: dispose,
  };
}

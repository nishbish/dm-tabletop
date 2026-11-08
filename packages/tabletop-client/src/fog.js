// Fog of war: one solid black volume with a soft edge, drawn as a screen pass after the scene.
//
// What the viewer already works out stays as it was: when a token is picked, the vision code
// raycasts around it and ends up with a polygon of what it can see. This file turns that polygon
// into three layers, kept on small canvases (about 16 pixels per grid cell, never more than 2048
// pixels a side) that the fog shader reads:
//   visible now     the polygon, blurred so its edge is soft
//   the one before  the previous polygon, so the change fades over about 0.4 s
//   explored        everything that was ever visible in this browser (never sent anywhere: the
//                   server's fog data is untouched)
//
// The fog is not made of planes. It is a volume over the map, from below the floor up to
// FOG_HEIGHT (solid) and fading out over the next FADE_HEIGHT: wherever the ground has not been
// seen, everything in that column is fog. The pass reads the depth of the scene, so for every pixel
// it knows the stretch of the view ray from the camera to the first thing it hits, and walks that
// stretch through the volume: the pixel is as dark as the thickest fog the ray passes through on
// the way. So:
//   - looking down, the fog over a spot is exactly as thick as the ground there is unseen, and the
//     edge of the view fades out as smoothly as the blurred layer does;
//   - looking from a low angle, a ray that slips under the edge into unseen ground meets fog and
//     stops there, so nothing can be seen under or through it, with no sides or curtains to build;
//   - a camera close to (or in) the fog is covered too, since the walk starts at the camera;
//   - there is one edge, so no planes overlap and no seams show.
// The floor fades out just inside the edge of what the token sees and is black from the edge on,
// so nothing past the edge shows; walls and tokens on the edge stay lit. The black has faint, slow
// swirls in two layers (one at the top of the fog, one deeper) that slide past each other as the
// camera moves; they are worked out once per pixel, only where there is fog.
//
// `material.opacity` still sets how strong the fog is (1 for players, 0.6 for the host's
// translucent view, 0 for the clear view); the rest of the viewer keeps changing it as before. In
// the translucent view, what was explored before shows through a thinner veil.
//
// The pass needs the depth of the scene: the composer's render targets must carry a depth texture
// (`attachDepth`). Pings are drawn after the fog, on their own layer (OVERLAY_LAYER), so a ping in
// the fog still shows.
//
// setSimple(true) is for slow devices (the Low graphics setting): half-size layers, fewer and longer
// steps along each ray, and plain black with no swirls.

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// objects on this layer are drawn after the fog (the main render leaves them out)
export var OVERLAY_LAYER = 3;

// everything up to this height over unseen ground is fog (walls are 2 high from y = -0.5)
var FOG_HEIGHT = 1.55;
// above it the fog thins out over this much, so its top has no hard line seen from the side
var FADE_HEIGHT = 0.3;
var FOG_BOTTOM = -0.6;
var MAX_TEXTURE = 2048;
var PIXELS_PER_CELL = 16;
var SIMPLE_PIXELS_PER_CELL = 8;
var FADE_SECONDS = 0.4;
// how soft the edge of the view is: the blur's spread, in grid cells. The floor fades out over about
// two of these inside the edge (fully clear where the blurred polygon reaches FLOOR_CLEAR) and is
// black from the edge on; the air, walls and tokens are clear up to the edge and black about one
// spread beyond it (where it is down to AIR_FOG). The vision polygon reaches a wall's far face, so
// walls on the edge stay lit.
var EDGE_BLUR = 0.25;
var FLOOR_CLEAR = 0.97;
var AIR_FOG = 0.12;
// the floor is at y = -0.5; anything this close above it counts as floor
var FLOOR_Y = -0.5;
// the deeper layer of swirls sits this high (the top layer at FOG_HEIGHT)
var SWIRL_DEEP = 0.0;
// how far apart (across the floor, in cells) the shader looks along a ray, and how many looks at most
var STEP = 0.2;
var MAX_STEPS = 64;
var SIMPLE_STEP = 0.5;
var SIMPLE_MAX_STEPS = 12;
// how much of the host's view the fog over explored ground hides
var VEIL = 0.5;

var vertexShader = [
  'varying vec2 vUv;',
  'void main() {',
  '	vUv = uv;',
  '	gl_Position = vec4(position.xy, 0.0, 1.0);',
  '}',
].join('\n');

var fragmentShader = [
  'varying vec2 vUv;',
  'uniform sampler2D tColor;',
  'uniform sampler2D tDepth;',
  'uniform sampler2D uVisible;',
  'uniform sampler2D uPrevious;',
  'uniform sampler2D uExplored;',
  'uniform vec2 uGrid;',
  'uniform float uMix;',
  'uniform float uStrength;',
  'uniform float uVeil;',
  'uniform float uStep;',
  'uniform float uTime;',
  'uniform mat4 uProjectionInverse;',
  'uniform mat4 uCameraWorld;',
  '',
  'vec3 unproject(float depth) {',
  '	vec4 view = uProjectionInverse * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);',
  '	return (uCameraWorld * vec4(view.xyz / view.w, 1.0)).xyz;',
  '}',
  '',
  '// How much fog stands over this spot: 1 where the ground is unseen, 0 where it is seen, soft',
  '// between. The blurred polygon is 0.5 on its edge. `lo`/`hi` say where the fade sits: the floor',
  '// fades out inside the edge and is black from the edge on; the air (and walls and tokens) stays',
  '// clear up to the edge, so a wall the token sees is never darkened.',
  'float cover(vec3 p, float lo, float hi) {',
  '	// grid cell centres are whole numbers, the map starts half a cell before cell 0',
  '	vec2 uv = vec2((p.x + 0.5) / uGrid.x, 1.0 - (p.z + 0.5) / uGrid.y);',
  '	float seen = texture2D(uVisible, uv).r;',
  '	if (uMix < 1.0) { seen = mix(texture2D(uPrevious, uv).r, seen, smoothstep(0.0, 1.0, uMix)); }',
  '	float fog = 1.0 - smoothstep(lo, hi, seen);',
  '	if (uVeil > 0.0) {',
  '		float explored = smoothstep(lo, hi, max(texture2D(uExplored, uv).r, seen));',
  '		fog *= 1.0 - ' + VEIL.toFixed(3) + ' * explored * uVeil;',
  '	}',
  '	return fog * (1.0 - smoothstep(' +
    FOG_HEIGHT.toFixed(3) +
    ', ' +
    (FOG_HEIGHT + FADE_HEIGHT).toFixed(3) +
    ', p.y));',
  '}',
  '',
  '#ifndef FOG_SIMPLE',
  'float hash(vec2 p) {',
  '	p = fract(p * vec2(123.34, 456.21));',
  '	p += dot(p, p + 45.32);',
  '	return fract(p.x * p.y);',
  '}',
  'float vnoise(vec2 p) {',
  '	vec2 i = floor(p);',
  '	vec2 f = fract(p);',
  '	f = f * f * (3.0 - 2.0 * f);',
  '	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);',
  '}',
  '// slow swirls: noise looked up at a spot that two more noises push round',
  'float swirl(vec2 p, float t) {',
  '	vec2 push = vec2(vnoise(p + vec2(t, -0.7 * t)), vnoise(p + vec2(5.2 - 0.6 * t, 1.3 + t)));',
  '	// turned off the grid of the noise, so its rows and columns never line up into straight lines',
  '	return vnoise(mat2(0.8, -0.6, 0.6, 0.8) * (p + 2.2 * (push - 0.5)));',
  '}',
  '// the colour of the fog where this ray meets it: two layers of swirls, one at the top of the fog',
  '// and one deeper down, which slide past each other as the camera moves, so the black has depth',
  'vec3 fogColour(vec3 a, vec3 ray, float enter, float leave) {',
  '	float tTop = clamp((' + FOG_HEIGHT.toFixed(3) + ' - a.y) / ray.y, enter, leave);',
  '	float tDeep = clamp((' + SWIRL_DEEP.toFixed(3) + ' - a.y) / ray.y, enter, leave);',
  '	vec2 top = (a + ray * tTop).xz;',
  '	vec2 deep = (a + ray * tDeep).xz;',
  '	float near = swirl(top * 0.42, uTime * 0.05);',
  '	float far = swirl(deep * 0.75 + 11.0, -uTime * 0.07);',
  '	float glow = 0.65 * near * near + 0.45 * far * far * far;',
  '	return vec3(0.055, 0.065, 0.085) * glow;',
  '}',
  '#endif',
  '',
  'void main() {',
  '	vec4 scene = texture2D(tColor, vUv);',
  '	gl_FragColor = scene;',
  '	if (uStrength < 0.001) { return; }',
  '',
  '	// the ray from the camera (its near plane) to the first thing it hits',
  '	float depth = texture2D(tDepth, vUv).x;',
  '	vec3 a = unproject(0.0);',
  '	vec3 ray = unproject(depth) - a;',
  '	ray = mix(ray, vec3(1e-6), vec3(lessThan(abs(ray), vec3(1e-6))));',
  '	// the part of it inside the fog volume',
  '	vec3 lo = vec3(-0.5, ' + FOG_BOTTOM.toFixed(3) + ', -0.5);',
  '	vec3 hi = vec3(uGrid.x - 0.5, ' + (FOG_HEIGHT + FADE_HEIGHT).toFixed(3) + ', uGrid.y - 0.5);',
  '	vec3 t0 = (lo - a) / ray;',
  '	vec3 t1 = (hi - a) / ray;',
  '	vec3 near = min(t0, t1);',
  '	vec3 far = max(t0, t1);',
  '	float enter = max(max(near.x, near.y), max(near.z, 0.0));',
  '	float leave = min(min(far.x, far.y), min(far.z, 1.0));',
  '	if (leave <= enter) { return; }',
  '',
  '	// the thickest fog along it; the fog only changes across the floor (and near the top), so the',
  '	// steps are spaced across the floor and a ray straight down needs only its two ends',
  '	vec3 p0 = a + ray * enter;',
  '	vec3 p1 = a + ray * leave;',
  '	bool floorHit = depth < 1.0 && leave > 0.999 && p1.y < ' + (FLOOR_Y + 0.08).toFixed(3) + ';',
  '	float fog = floorHit ? cover(p1, 0.5, ' +
    FLOOR_CLEAR.toFixed(3) +
    ') : cover(p1, ' +
    AIR_FOG.toFixed(3) +
    ', 0.5);',
  '	float steps = clamp(ceil(length(p1.xz - p0.xz) / uStep), 1.0, float(FOG_STEPS));',
  '	for (int i = 0; i < FOG_STEPS; i++) {',
  '		if (float(i) >= steps || fog > 0.999) { break; }',
  '		fog = max(fog, cover(mix(p0, p1, float(i) / steps), ' + AIR_FOG.toFixed(3) + ', 0.5));',
  '	}',
  '	float alpha = fog * uStrength;',
  '	if (alpha < 0.002) { return; }',
  '',
  '#ifdef FOG_SIMPLE',
  '	vec3 colour = vec3(0.0);',
  '#else',
  '	vec3 colour = fogColour(a, ray, enter, leave);',
  '#endif',
  '	// a touch of dither, so the dark gradient of the edge shows no bands',
  '	float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;',
  '	gl_FragColor = vec4(max(mix(scene.rgb, colour, alpha) + dither * alpha / 255.0, 0.0), scene.a);',
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

// Gives the composer's two render targets a depth texture each, which the fog pass reads. Call it
// before the composer first renders.
export function attachDepth(composer) {
  [composer.renderTarget1, composer.renderTarget2].forEach(function (target) {
    if (!target.depthTexture) {
      target.depthTexture = new THREE.DepthTexture(target.width, target.height);
    }
  });
}

// The pass: copies the scene through the fog shader, then draws the overlay layer on top.
class FogPass extends Pass {
  constructor(material) {
    super();
    this.material = material;
    this.quad = new FullScreenQuad(material);
    this.scene = null;
    this.camera = null;
    this.overlay = null;
  }

  render(renderer, writeBuffer, readBuffer) {
    var uniforms = this.material.uniforms;
    var camera = this.camera;

    uniforms.tColor.value = readBuffer.texture;
    uniforms.tDepth.value = readBuffer.depthTexture;
    if (camera) {
      // the main render has just brought the camera's matrices up to date
      uniforms.uProjectionInverse.value.copy(camera.projectionMatrixInverse);
      uniforms.uCameraWorld.value.copy(camera.matrixWorld);
    }
    // without the scene's depth (or a camera) there is nothing to measure against: no fog
    var strength = uniforms.uStrength.value;
    if (!readBuffer.depthTexture || !camera) {
      uniforms.uStrength.value = 0;
    }

    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
    uniforms.uStrength.value = strength;

    if (this.scene && camera && this.overlay && this.overlay()) {
      var layers = camera.layers.mask;
      var autoClear = renderer.autoClear;
      camera.layers.set(OVERLAY_LAYER);
      renderer.autoClear = false;
      renderer.render(this.scene, camera);
      renderer.autoClear = autoClear;
      camera.layers.mask = layers;
    }
  }

  dispose() {
    this.quad.dispose();
  }
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

  var material = new THREE.ShaderMaterial({
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    defines: { FOG_STEPS: MAX_STEPS },
    uniforms: {
      tColor: { value: null },
      tDepth: { value: null },
      uVisible: { value: null },
      uPrevious: { value: null },
      uExplored: { value: null },
      uMix: { value: 1 },
      uStrength: { value: 1 },
      uVeil: { value: 0 },
      uStep: { value: STEP },
      uTime: { value: 0 },
      uGrid: { value: new THREE.Vector2(1, 1) },
      uProjectionInverse: { value: new THREE.Matrix4() },
      uCameraWorld: { value: new THREE.Matrix4() },
    },
  });
  material.opacity = 1;

  var pass = new FogPass(material);

  function disposeLayers() {
    if (!fog.layers) {
      return;
    }

    fog.layers.forEach(function (layer) {
      layer.texture.dispose();
    });
    fog.layers = null;
  }

  // (Re)builds the canvases for a grid of this size.
  function setGrid(width, height) {
    fog.width = width;
    fog.height = height;

    material.uniforms.uGrid.value.set(Math.max(1, width), Math.max(1, height));

    disposeLayers();
    makeLayers();
    fog.mix = 1;
    clearLayers();
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

  // Switches between the full fog and the cheap one. What was seen is kept: the layers are copied
  // to the new resolution.
  function setSimple(simple) {
    simple = !!simple;
    if (simple === fog.simple) {
      return;
    }

    fog.simple = simple;
    material.defines.FOG_STEPS = simple ? SIMPLE_MAX_STEPS : MAX_STEPS;
    if (simple) {
      material.defines.FOG_SIMPLE = '';
    } else {
      delete material.defines.FOG_SIMPLE;
    }
    material.uniforms.uStep.value = simple ? SIMPLE_STEP : STEP;
    material.needsUpdate = true;

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

  // Where the token sees right up to the edge of the map, the polygon stops at the edge, and the
  // blur would fade it out there, leaving a thin band of fog along the edge of the world (and a
  // wisp in its corners). So a point on the edge is carried on past it, along the line of sight
  // from `from` (where the token stands), until it is well clear of the canvas; and where the
  // polygon runs from one edge of the map to the next, the corner between them is added. Shadow
  // lines that end on the edge keep their direction, so nothing more of the map is revealed.
  // Returns the points in pixels.
  function reachEdges(points, from) {
    var x0 = -0.5;
    var z0 = -0.5;
    var x1 = fog.width - 0.5;
    var z1 = fog.height - 0.5;
    var near = 0.05;
    var pad = EDGE_BLUR * 4;
    var cx = 0;
    var cz = 0;

    if (!from) {
      points.forEach(function (p) {
        cx += p.x / points.length;
        cz += p.z / points.length;
      });
      from = { x: cx, z: cz };
    }

    // which edges a point lies on: l(eft), r(ight), t(op, z0), b(ottom, z1)
    function edges(p) {
      return {
        l: p.x <= x0 + near,
        r: p.x >= x1 - near,
        t: p.z <= z0 + near,
        b: p.z >= z1 - near,
      };
    }

    function carry(p, on) {
      var dx = p.x - from.x;
      var dz = p.z - from.z;
      var length = Math.sqrt(dx * dx + dz * dz);
      if (length < 1e-6) {
        return { x: p.x, z: p.z };
      }
      dx /= length;
      dz /= length;
      // how far along the line of sight it takes to get `pad` past the edge it is on (a glancing
      // line is not carried further than a few pads)
      var out = Math.max(on.l ? -dx : 0, on.r ? dx : 0, on.t ? -dz : 0, on.b ? dz : 0);
      var t = pad / Math.max(out, 0.25);

      return { x: p.x + dx * t, z: p.z + dz * t };
    }

    function corner(a, b) {
      var x = a.l || b.l ? x0 - pad : a.r || b.r ? x1 + pad : null;
      var z = a.t || b.t ? z0 - pad : a.b || b.b ? z1 + pad : null;
      // only between neighbouring edges: one side and one end of the map
      if (x === null || z === null) {
        return null;
      }
      var sideA = a.l || a.r;
      var sideB = b.l || b.r;
      var endA = a.t || a.b;
      var endB = b.t || b.b;

      return (sideA && endB && !endA) || (endA && sideB && !sideA) ? { x: x, z: z } : null;
    }

    var out = [];
    points.forEach(function (p, i) {
      var on = edges(p);
      var onEdge = on.l || on.r || on.t || on.b;
      out.push(onEdge ? carry(p, on) : { x: p.x, z: p.z });

      var q = points[(i + 1) % points.length];
      var next = edges(q);
      if (onEdge && (next.l || next.r || next.t || next.b)) {
        var c = corner(on, next);
        if (c) {
          out.push(c);
        }
      }
    });

    return out.map(function (p) {
      return { x: (p.x + 0.5) * fog.scale, y: (p.z + 0.5) * fog.scale };
    });
  }

  // Draws the polygon in white, softly, onto a layer (on top of what is there when `keep`).
  function drawPolygon(l, points, keep, from) {
    var ctx = l.context;
    var blur = Math.max(1.5, fog.scale * EDGE_BLUR);

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
    reachEdges(points, from).forEach(function (p, i) {
      if (i === 0) {
        ctx.moveTo(p.x, p.y);
      } else {
        ctx.lineTo(p.x, p.y);
      }
    });
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    l.texture.needsUpdate = true;
  }

  // The polygon of what the active token sees now: [{x, z}, ...] in grid coordinates, and where
  // the token stands ({x, z}; optional, used to carry rays that reach the map's edge past it).
  function setVision(points, from) {
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
      drawPolygon(visible, points, false, from);
      drawPolygon(layer('explored'), points, true, from);
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

  // The scene and a test for whether anything on OVERLAY_LAYER is showing (drawn after the fog).
  function setOverlay(scene, showing) {
    pass.scene = scene;
    pass.overlay = showing;
  }

  var last = performance.now();

  // Called every frame with the camera the scene is drawn with.
  function update(now, camera) {
    var dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;

    if (fog.mix < 1) {
      fog.mix = Math.min(1, fog.mix + dt / FADE_SECONDS);
    }

    var strength = material.opacity;
    material.uniforms.uMix.value = fog.mix;
    material.uniforms.uTime.value = (now - fog.start) / 1000;
    material.uniforms.uStrength.value = strength;
    // the memory of explored ground only shows when the fog is translucent (the host's view):
    // at full strength a player sees nothing outside what the token sees now
    material.uniforms.uVeil.value = 1 - THREE.MathUtils.smoothstep(strength, 0.9, 1);
    if (camera) {
      pass.camera = camera;
    }
    // in the clear view, with no ping showing, the pass would only copy the frame: skip it
    pass.enabled = strength > 0.001 || !!(pass.overlay && pass.overlay());
  }

  function dispose() {
    disposeLayers();
    material.dispose();
    pass.dispose();
  }

  setGrid(gridWidth, gridHeight);

  return {
    material: material,
    pass: pass,
    setGrid: setGrid,
    setVision: setVision,
    setSimple: setSimple,
    setOverlay: setOverlay,
    reset: reset,
    update: update,
    dispose: dispose,
  };
}

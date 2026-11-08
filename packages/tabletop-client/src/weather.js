// Rain, snow, lightning and fog over the map (time-weather.ts has the words and colours).
//
// Kept light on purpose: the rain and snow are ONE set of points whose fall, drift and wrap-around
// are worked out on the graphics card. Each frame the browser only hands over a clock and where
// the camera looks, so a storm costs about the same as a still frame and nothing is allocated.
// The points sit in a box round the spot the camera looks at, sized to the zoom, so the screen
// shows about the same amount of rain whether the view is close or far. Visitors who ask their
// system for less motion get no falling points and no lightning; the light, sky and fog still
// change.

var MAX_POINTS = 2600;

var KINDS = {
  rain: {
    count: 1600,
    speed: 1.6,
    drift: 0,
    size: 0.05,
    color: [0.72, 0.8, 0.92],
    opacity: 0.5,
    round: 0,
  },
  storm: {
    count: 2600,
    speed: 2.2,
    drift: 0.01,
    size: 0.06,
    color: [0.68, 0.74, 0.86],
    opacity: 0.6,
    round: 0,
  },
  snow: {
    count: 1200,
    speed: 0.12,
    drift: 0.03,
    size: 0.022,
    color: [1, 1, 1],
    opacity: 0.9,
    round: 1,
  },
};

var VERTEX = [
  'attribute float aSeed;',
  'uniform float uTime;',
  'uniform vec3 uCenter;',
  'uniform float uSize;',
  'uniform float uSpeed;',
  'uniform float uDrift;',
  'uniform float uPointSize;',
  'uniform float uScale;',
  'varying float vAlpha;',
  'void main() {',
  '	float side = uSize * 2.0;',
  // 1 at the top of the box, 0 on the floor; every point falls at its own pace
  '	float fall = fract(position.y - uTime * uSpeed * (0.75 + 0.5 * aSeed));',
  '	float sway = sin(uTime * 0.8 + aSeed * 6.2832) * uDrift;',
  // fixed in the world and wrapped round the box, so moving the camera never drags the rain along
  '	vec3 p = vec3(',
  '		uCenter.x + (fract(position.x + sway - uCenter.x / side) - 0.5) * side,',
  '		uCenter.y + fall * uSize * 1.2,',
  '		uCenter.z + (fract(position.z - uCenter.z / side) - 0.5) * side);',
  '	vec4 mv = modelViewMatrix * vec4(p, 1.0);',
  '	gl_Position = projectionMatrix * mv;',
  '	gl_PointSize = min(uPointSize * uScale / max(-mv.z, 0.001), 48.0);',
  '	vAlpha = smoothstep(0.0, 0.06, fall) * smoothstep(1.0, 0.85, fall);',
  '}',
].join('\n');

var FRAGMENT = [
  'uniform vec3 uColor;',
  'uniform float uOpacity;',
  'uniform float uRound;',
  'varying float vAlpha;',
  'void main() {',
  '	vec2 c = gl_PointCoord - 0.5;',
  // snow (and rain seen from straight above) is a soft dot, rain a thin upright streak
  '	float a = uRound > 0.5',
  '		? 1.0 - smoothstep(0.15, 0.5, length(c))',
  '		: (1.0 - smoothstep(0.02, 0.08, abs(c.x))) * (1.0 - smoothstep(0.25, 0.5, abs(c.y)));',
  '	a *= uOpacity * vAlpha;',
  '	if (a < 0.01) discard;',
  '	gl_FragColor = vec4(uColor, a);',
  '}',
].join('\n');

function prefersLessMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

export function createWeather(THREE, scene) {
  var kind = 'clear';
  var points = null;
  var fogColor = new THREE.Color(0xb8bec4);
  var nextFlash = 0;
  var flashStart = -1;
  var uniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uSize: { value: 30 },
    uSpeed: { value: 1 },
    uDrift: { value: 0 },
    uPointSize: { value: 1 },
    uScale: { value: 500 },
    uColor: { value: new THREE.Color() },
    uOpacity: { value: 0.5 },
    uRound: { value: 0 },
  };

  // made the first time it rains or snows, then kept: switching weather only changes numbers
  function makePoints() {
    var positions = new Float32Array(MAX_POINTS * 3);
    var seeds = new Float32Array(MAX_POINTS);
    for (var i = 0; i < MAX_POINTS; i++) {
      positions[i * 3] = Math.random();
      positions[i * 3 + 1] = Math.random();
      positions[i * 3 + 2] = Math.random();
      seeds[i] = Math.random();
    }
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    var material = new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    var made = new THREE.Points(geometry, material);
    // the shader places the points, so three.js cannot know where they are
    made.frustumCulled = false;
    made.renderOrder = 900;
    made.visible = false;
    made.name = 'weather';
    scene.add(made);
    return made;
  }

  function set(next) {
    kind = next;
    var falling = KINDS[kind];
    if (falling && !prefersLessMotion()) {
      if (!points) {
        points = makePoints();
      }
      points.geometry.setDrawRange(0, falling.count);
      uniforms.uSpeed.value = falling.speed;
      uniforms.uDrift.value = falling.drift;
      uniforms.uColor.value.setRGB(falling.color[0], falling.color[1], falling.color[2]);
      uniforms.uOpacity.value = falling.opacity;
      points.visible = true;
    } else if (points) {
      points.visible = false;
    }

    if (kind === 'fog') {
      if (!scene.fog) {
        scene.fog = new THREE.Fog(fogColor, 10, 100);
      }
    } else {
      scene.fog = null;
    }
    nextFlash = 0;
    flashStart = -1;
  }

  function setFogColor(hex) {
    fogColor.setHex(hex);
    if (scene.fog) {
      scene.fog.color.copy(fogColor);
    }
  }

  // Once a frame. Returns how much lightning to add to the light right now (0 = none).
  function update(now, camera, target, viewHeight, view2d) {
    var distance = camera.position.distanceTo(target);

    if (scene.fog) {
      scene.fog.near = distance * 0.35;
      scene.fog.far = distance * 1.9 + 20;
    }

    if (points && points.visible) {
      var size = Math.min(150, Math.max(12, distance * 0.6));
      var falling = KINDS[kind];
      uniforms.uTime.value = now / 1000;
      uniforms.uCenter.value.copy(target);
      uniforms.uSize.value = size;
      uniforms.uPointSize.value = size * falling.size;
      uniforms.uScale.value = viewHeight / 2;
      uniforms.uRound.value = falling.round || view2d ? 1 : 0;
    }

    if (kind !== 'storm' || prefersLessMotion()) {
      return 0;
    }

    // a flicker every 6 to 15 seconds: two quick flashes, well under the three a second that
    // can trouble people sensitive to flashing light
    if (!nextFlash) {
      nextFlash = now + 3000 + Math.random() * 6000;
    }
    if (now >= nextFlash) {
      flashStart = now;
      nextFlash = now + 6000 + Math.random() * 9000;
    }
    if (flashStart < 0) {
      return 0;
    }
    var t = now - flashStart;
    if (t < 90) {
      return 1;
    }
    if (t < 180) {
      return 0.2;
    }
    if (t < 300) {
      return 0.7 * (1 - (t - 180) / 120);
    }
    flashStart = -1;
    return 0;
  }

  function dispose() {
    if (points) {
      scene.remove(points);
      points.geometry.dispose();
      points.material.dispose();
      points = null;
    }
    scene.fog = null;
  }

  return { set: set, setFogColor: setFogColor, update: update, dispose: dispose };
}

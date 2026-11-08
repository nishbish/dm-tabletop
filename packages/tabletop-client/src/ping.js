// The ping: ripples spreading over the floor from a bright point, and in the 3D view a thin beam of
// light so it can be found from low angles. Everything is worked out in two small shaders on flat
// quads, so a ping is two draw calls for as long as it plays and nothing at all otherwise. A few
// are kept ready, so players pinging at the same moment do not cut each other off.

import * as THREE from 'three';

var POOL_SIZE = 6;
var DURATION_MS = 1500;
// the beam is this many times the radius of the ripples
var BEAM_HEIGHT = 2.6;
var BEAM_WIDTH = 0.34;
// after the fog of war (renderOrder 100)
var RENDER_ORDER = 200;

var vertexShader = [
  'varying vec2 vUv;',
  'void main() {',
  '	vUv = uv;',
  '	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
  '}',
].join('\n');

var rippleShader = [
  'varying vec2 vUv;',
  'uniform vec3 uColor;',
  'uniform float uTime;',
  '',
  '// one ring; `start` is when it leaves the middle, as a share of the whole ping',
  'float ring(float d, float start) {',
  '	float t = clamp((uTime - start) / (1.0 - start), 0.0, 1.0);',
  '	if (uTime <= start || t >= 1.0) { return 0.0; }',
  '	float eased = 1.0 - (1.0 - t) * (1.0 - t) * (1.0 - t);',
  '	float width = mix(0.07, 0.02, t);',
  '	return smoothstep(width, 0.0, abs(d - eased * 0.94)) * (1.0 - t) * (1.0 - t);',
  '}',
  'void main() {',
  '	float d = length(vUv * 2.0 - 1.0);',
  '	if (d > 1.0) { discard; }',
  '	float rings = ring(d, 0.0) + 0.7 * ring(d, 0.16) + 0.45 * ring(d, 0.32);',
  '	float fade = 1.0 - uTime;',
  '	// a soft pool of colour under the rings, and a bright point that shrinks away',
  '	float pool = (1.0 - smoothstep(0.0, 0.8, d)) * 0.34 * fade * fade;',
  '	float point = (1.0 - smoothstep(0.0, 0.16 * (1.0 - uTime * 0.7), d)) * smoothstep(0.0, 0.05, uTime) * fade;',
  '	float alpha = clamp(rings + pool + point, 0.0, 1.0);',
  '	// the brightest parts run towards white, so the ping reads on any map',
  '	float hot = clamp(rings * 0.6 + point, 0.0, 1.0);',
  '	gl_FragColor = vec4(mix(uColor, vec3(1.0), hot * 0.75), alpha);',
  '}',
].join('\n');

var beamShader = [
  'varying vec2 vUv;',
  'uniform vec3 uColor;',
  'uniform float uTime;',
  '',
  'void main() {',
  '	float across = 1.0 - abs(vUv.x * 2.0 - 1.0);',
  '	float rise = smoothstep(0.0, 0.3, uTime);',
  '	float reach = 1.0 - smoothstep(rise * 0.7, rise, vUv.y);',
  '	float fade = 1.0 - smoothstep(0.25, 1.0, uTime);',
  '	float alpha = across * across * across * (1.0 - vUv.y) * reach * fade * 0.8;',
  '	gl_FragColor = vec4(mix(uColor, vec3(1.0), across * across * 0.6), alpha);',
  '}',
].join('\n');

function makeMaterial(fragmentShader) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uTime: { value: 1 } },
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function makeMesh(scene, geometry, material) {
  var mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'ping';
  mesh.renderOrder = RENDER_ORDER;
  mesh.visible = false;
  scene.add(mesh);

  return mesh;
}

export function createPing(scene) {
  var rippleGeometry = new THREE.PlaneGeometry(2, 2);
  rippleGeometry.rotateX(-Math.PI / 2);
  var beamGeometry = new THREE.PlaneGeometry(1, 1);
  beamGeometry.translate(0, 0.5, 0);

  var rippleMaterial = makeMaterial(rippleShader);
  var beamMaterial = makeMaterial(beamShader);
  var pings = [];

  for (var i = 0; i < POOL_SIZE; i++) {
    pings.push({
      // clones share one compiled shader
      ripple: makeMesh(scene, rippleGeometry, i == 0 ? rippleMaterial : rippleMaterial.clone()),
      beam: makeMesh(scene, beamGeometry, i == 0 ? beamMaterial : beamMaterial.clone()),
      started: 0,
      active: false,
    });
  }

  var active = 0;

  function stop(ping) {
    ping.active = false;
    ping.ripple.visible = false;
    ping.beam.visible = false;
    active--;
  }

  return {
    // `size` is the radius of the ripples in world units, `withBeam` adds the beam.
    play: function (x, y, z, color, size, withBeam) {
      var ping = pings.find(function (p) {
        return !p.active;
      });

      if (!ping) {
        ping = pings.reduce(function (oldest, p) {
          return p.started < oldest.started ? p : oldest;
        });
        stop(ping);
      }

      ping.active = true;
      ping.started = performance.now();
      active++;

      ping.ripple.position.set(x, y, z);
      ping.ripple.scale.setScalar(size);
      ping.ripple.material.uniforms.uColor.value.setHex(color);
      ping.ripple.material.uniforms.uTime.value = 0;
      ping.ripple.visible = true;

      ping.beam.position.set(x, y, z);
      ping.beam.scale.set(size * BEAM_WIDTH, size * BEAM_HEIGHT, 1);
      ping.beam.material.uniforms.uColor.value.setHex(color);
      ping.beam.material.uniforms.uTime.value = 0;
      ping.beam.visible = !!withBeam;
    },

    // Called every frame; `facing` is the camera's turn around the table, which the beam follows.
    update: function (facing) {
      if (active == 0) {
        return;
      }

      var now = performance.now();

      for (var i = 0; i < pings.length; i++) {
        var ping = pings[i];

        if (ping.active) {
          var t = (now - ping.started) / DURATION_MS;

          if (t >= 1) {
            stop(ping);
          } else {
            ping.ripple.material.uniforms.uTime.value = t;
            ping.beam.material.uniforms.uTime.value = t;
            ping.beam.rotation.y = facing;
          }
        }
      }
    },

    // The two meshes that compile the shaders while the load screen is up (they draw nothing yet).
    warmUpMeshes: [pings[0].ripple, pings[0].beam],

    dispose: function () {
      rippleGeometry.dispose();
      beamGeometry.dispose();

      pings.forEach(function (ping) {
        ping.ripple.material.dispose();
        ping.beam.material.dispose();
      });
    },
  };
}

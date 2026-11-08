// Shadows on the table, for the High graphics setting only. One system for everything that stands
// on the map: tokens, 3D characters and anything a host app adds (its dice, through
// createCaster). Medium and Low never create any of this, so they cost nothing extra.
//
// How it stays cheap and leaves the look alone:
//  - one directional light with intensity 0: it lights nothing, it only casts. The scene keeps its
//    own ambient and hemisphere light exactly as before;
//  - the shadows land on a "catcher", a flat ShadowMaterial square just above the floor and map
//    pictures, that only darkens where a shadow falls, so the map is not relit;
//  - a small shadow map that covers only the floor around the point the camera looks at, fitted
//    as the view moves, and drawn again only when a caster or the view has moved (autoUpdate off);
//  - casters a host app adds are seen only by the shadow camera (their own layer), never drawn.
import * as THREE from 'three';

// casters that only the shadow camera sees (fog.js uses layer 3)
export var SHADOW_LAYER = 5;
export var MAP_SIZE = 1024;
// the catcher sits above the floor (-0.53), the map pictures (-0.52) and the grid (-0.51)
var CATCHER_LIFT = 0.025;
// where the light comes from: high, a little to the right and towards the viewer
var LIGHT_DIRECTION = new THREE.Vector3(0.35, 1, 0.3).normalize();
var LIGHT_DISTANCE = 60;
var MIN_HALF = 4;
var MAX_HALF = 60;

export function createShadows(scene, renderer, options) {
  options = options || {};
  var opacity = options.opacity == null ? 0.32 : options.opacity;
  var enabled = false;
  var casters = new Set();
  var lastSignature = '';
  var touched = false;
  var fitted = { x: NaN, z: NaN, half: NaN, floorY: NaN };

  var light = new THREE.DirectionalLight(0xffffff, 0);
  light.name = 'shadowLight';
  light.castShadow = true;
  light.shadow.mapSize.set(MAP_SIZE, MAP_SIZE);
  light.shadow.bias = -0.0005;
  light.shadow.normalBias = 0.02;
  light.shadow.camera.layers.enable(SHADOW_LAYER);

  var catcherMaterial = new THREE.ShadowMaterial({ opacity: opacity, depthWrite: false });
  var catcherGeometry = new THREE.PlaneGeometry(1, 1);
  catcherGeometry.rotateX(-Math.PI / 2);
  var catcher = new THREE.Mesh(catcherGeometry, catcherMaterial);
  catcher.name = 'shadowCatcher';
  catcher.receiveShadow = true;
  catcher.renderOrder = 1;
  catcher.raycast = function () {}; // never picked by the mouse

  function setEnabled(on) {
    on = !!on;
    if (on === enabled) {
      return;
    }
    enabled = on;
    renderer.shadowMap.enabled = on;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (on) {
      scene.add(light, light.target, catcher);
      lastSignature = '';
      renderer.shadowMap.needsUpdate = true;
    } else {
      scene.remove(light, light.target, catcher);
      // three keeps the old map; free it when shadows are switched off
      if (light.shadow.map) {
        light.shadow.map.dispose();
        light.shadow.map = null;
      }
    }
    catcherMaterial.needsUpdate = true;
    casters.forEach(function (object) {
      setCasting(object, on);
    });
  }

  // Lit meshes cast (token pictures and bases, 3D characters, props); flat-colour helpers such as
  // health bars and highlights do not, unless marked as casters.
  function setCasting(object, on) {
    var meshes = 0;
    object.traverse(function (child) {
      if (child.isMesh) {
        child.castShadow =
          on &&
          (!!child.userData.shadowCaster ||
            !(child.material && child.material.isMeshBasicMaterial));
        meshes++;
      }
    });
    return meshes;
  }

  // Covers the floor around `target` (the point the camera looks at); `viewSize` is how much floor
  // shows (its height, in world units). Snapped to whole shadow texels so panning does not shimmer.
  function fit(target, floorY, viewSize) {
    if (!enabled) {
      return false;
    }
    var half = Math.min(MAX_HALF, Math.max(MIN_HALF, viewSize * 0.75));
    var texel = (2 * half) / MAP_SIZE;
    var x = Math.round(target.x / texel) * texel;
    var z = Math.round(target.z / texel) * texel;
    if (x === fitted.x && z === fitted.z && half === fitted.half && floorY === fitted.floorY) {
      return false;
    }
    fitted = { x: x, z: z, half: half, floorY: floorY };
    light.target.position.set(x, floorY, z);
    light.position.copy(LIGHT_DIRECTION).multiplyScalar(LIGHT_DISTANCE).add(light.target.position);
    var cam = light.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = LIGHT_DISTANCE * 2;
    cam.updateProjectionMatrix();
    light.target.updateMatrixWorld();
    light.updateMatrixWorld();
    // a little bigger than what the light covers, since the light comes in at an angle
    catcher.position.set(x, floorY + CATCHER_LIFT, z);
    catcher.scale.set(half * 2.4, 1, half * 2.4);
    renderer.shadowMap.needsUpdate = true;
    return true;
  }

  // Call once a frame before drawing: redraws the shadow map only if a caster moved, appeared or
  // went (or touch() said an animation moved one).
  function update() {
    if (!enabled) {
      return false;
    }
    var parts = [];
    casters.forEach(function (object) {
      // taken off the map: forget it
      if (!object.parent) {
        casters.delete(object);
        return;
      }
      if (!object.visible) {
        return;
      }
      // pieces that load later (a token's picture) cast too
      parts.push(setCasting(object, true));
      object.updateMatrixWorld();
      var e = object.matrixWorld.elements;
      // position and turn are enough to notice a move (rounded: tiny jitter is not a move)
      parts.push(
        Math.round(e[12] * 1000),
        Math.round(e[13] * 1000),
        Math.round(e[14] * 1000),
        Math.round(e[0] * 1000),
        Math.round(e[2] * 1000),
        Math.round(e[5] * 1000),
        Math.round(e[8] * 1000),
      );
    });
    var signature = parts.join(',');
    if (touched) {
      touched = false;
      signature += '*';
      lastSignature = '';
    }
    if (signature === lastSignature) {
      return false;
    }
    lastSignature = signature;
    renderer.shadowMap.needsUpdate = true;
    return true;
  }

  // Something on the map that casts a shadow (a token, a 3D character). Its meshes cast only while
  // shadows are on.
  function addCaster(object) {
    casters.add(object);
    setCasting(object, enabled);
    lastSignature = '';
  }

  function removeCaster(object) {
    if (casters.delete(object)) {
      lastSignature = '';
      renderer.shadowMap.needsUpdate = enabled;
    }
  }

  // Something moved that update() cannot see (an animated 3D character's limbs): redraw.
  function touch() {
    touched = enabled;
  }

  // A shadow for something the host app draws itself (its dice, on their own canvas over the
  // table): `positions` are the triangles of its shape (x, y, z for each corner). Never drawn, only
  // seen by the shadow camera. The host moves it with set() and drops it with remove().
  function createCaster(positions) {
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(Array.from(positions), 3));
    geometry.computeBoundingSphere();
    var mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    );
    mesh.layers.set(SHADOW_LAYER);
    mesh.userData.shadowCaster = true;
    mesh.frustumCulled = false;
    mesh.raycast = function () {};
    scene.add(mesh);
    addCaster(mesh);
    return {
      set: function (position, quaternion, scale) {
        mesh.position.fromArray(position);
        mesh.quaternion.fromArray(quaternion);
        mesh.scale.setScalar(scale == null ? 1 : scale);
      },
      remove: function () {
        removeCaster(mesh);
        scene.remove(mesh);
        geometry.dispose();
        mesh.material.dispose();
      },
    };
  }

  // Darker shadows in bright light, fainter at night (0..1 of full strength).
  function setStrength(strength) {
    catcherMaterial.opacity = opacity * Math.max(0, Math.min(1, strength));
  }

  function dispose() {
    setEnabled(false);
    catcherGeometry.dispose();
    catcherMaterial.dispose();
    light.dispose();
  }

  return {
    get enabled() {
      return enabled;
    },
    setEnabled: setEnabled,
    fit: fit,
    update: update,
    addCaster: addCaster,
    removeCaster: removeCaster,
    createCaster: createCaster,
    touch: touch,
    setStrength: setStrength,
    dispose: dispose,
    light: light,
    catcher: catcher,
  };
}

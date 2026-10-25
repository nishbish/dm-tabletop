// Walls drawn with a 3D model (glTF) instead of plain boxes. The model is one stretch of wall; it
// is normalised once (one unit long, wall height tall, standing on the floor, centred) and then
// drawn as instances: one InstancedMesh per part of the model for ALL walls together, so a map
// full of walls costs a few draw calls, and moving a wall only rewrites matrices.
//
// The plain box walls stay in the scene, hidden, because collisions and token vision raycast
// against them (an invisible mesh still raycasts).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { joinAssetUrl } from './config';
import { FLOOR_Y, WALL_HEIGHT, wallTiles } from './walls';

export function createWallModel(options, scene, onReady) {
  var config = options.wallModel;
  var src = /^(https?:|data:|blob:)/i.test(config.src)
    ? config.src
    : joinAssetUrl(options.assetBaseUrl, config.src);
  var tileWidth = config.tileWidth > 0 ? config.tileWidth : 1;
  var parts = []; // {geometry, material, mesh, capacity}
  var lastPieces = [];
  var disposed = false;
  var scratch = new THREE.Object3D();

  var model = {
    ready: false,
    update: function (pieces) {
      lastPieces = pieces;
      if (model.ready) {
        place();
      }
    },
    dispose: function () {
      disposed = true;
      parts.forEach(function (part) {
        if (part.mesh) {
          scene.remove(part.mesh);
          part.mesh.dispose();
        }
        part.geometry.dispose();
        disposeMaterial(part.material);
      });
      parts = [];
    },
  };

  new GLTFLoader().load(
    src,
    function (gltf) {
      if (disposed) {
        return;
      }
      parts = normalisedParts(gltf.scene);
      if (parts.length === 0) {
        console.warn('wall model has no meshes; keeping the plain walls');
        return;
      }
      model.ready = true;
      place();
      onReady();
    },
    undefined,
    function () {
      // the plain walls stay visible, so a missing model only costs the look
      console.warn('wall model could not be loaded; keeping the plain walls');
    },
  );

  function place() {
    var tiles = wallTiles(lastPieces, tileWidth);

    parts.forEach(function (part) {
      if (!part.mesh || part.capacity < tiles.length) {
        if (part.mesh) {
          scene.remove(part.mesh);
          part.mesh.dispose();
        }
        // room to grow, so drawing a few more walls does not reallocate every time
        part.capacity = Math.max(64, Math.ceil(tiles.length * 1.5));
        part.mesh = new THREE.InstancedMesh(part.geometry, part.material, part.capacity);
        part.mesh.name = 'wall model';
        part.mesh.matrixAutoUpdate = false;
        part.mesh.raycast = function () {}; // the hidden boxes answer raycasts
        scene.add(part.mesh);
      }

      tiles.forEach(function (tile, i) {
        scratch.position.set(tile.x, 0, tile.z);
        scratch.rotation.set(0, tile.rotation, 0);
        scratch.scale.set(tile.length, 1, 1);
        scratch.updateMatrix();
        part.mesh.setMatrixAt(i, scratch.matrix);
      });

      part.mesh.count = tiles.length;
      part.mesh.instanceMatrix.needsUpdate = true;
      part.mesh.computeBoundingSphere();
    });
  }

  return model;
}

// Every mesh of the model with its transform baked in, scaled to a one-unit, wall-height tile
// standing on the floor and centred on x and z. Depth keeps the model's proportions.
function normalisedParts(root) {
  var parts = [];
  root.updateMatrixWorld(true);
  root.traverse(function (object) {
    if (!object.isMesh) {
      return;
    }
    var geometry = object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    parts.push({
      geometry: geometry,
      material: toSceneMaterial(object.material),
      mesh: null,
      capacity: 0,
    });
  });

  if (parts.length === 0) {
    return parts;
  }

  var box = new THREE.Box3();
  parts.forEach(function (part) {
    part.geometry.computeBoundingBox();
    box.union(part.geometry.boundingBox);
  });

  var size = box.getSize(new THREE.Vector3());
  var center = box.getCenter(new THREE.Vector3());
  var height = WALL_HEIGHT / (size.y || 1);
  var fit = new THREE.Matrix4()
    .makeTranslation(0, FLOOR_Y, 0)
    .multiply(new THREE.Matrix4().makeScale(1 / (size.x || 1), height, height))
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));

  parts.forEach(function (part) {
    part.geometry.applyMatrix4(fit);
    part.geometry.computeBoundingSphere();
  });

  return parts;
}

// The rest of the scene uses Phong materials and passes texture colours straight through (see the
// colour management note in tabletop.js). glTF gives physically based materials, which come out
// far too dark under the scene's lights, so the model's colour and picture are moved over.
function toSceneMaterial(material) {
  if (Array.isArray(material)) {
    return material.map(toSceneMaterial);
  }
  var map = material.map || null;
  if (map) {
    map.colorSpace = THREE.NoColorSpace;
    map.anisotropy = 4;
    map.needsUpdate = true;
  }
  var phong = new THREE.MeshPhongMaterial({
    color: material.color ? material.color.clone() : 0xffffff,
    map: map,
    side: material.side,
    transparent: material.transparent,
    alphaTest: material.alphaTest,
  });
  phong.name = material.name;
  material.dispose();
  return phong;
}

function disposeMaterial(material) {
  (Array.isArray(material) ? material : [material]).forEach(function (m) {
    if (!m) {
      return;
    }
    for (var key in m) {
      if (m[key] && m[key].isTexture) {
        m[key].dispose();
      }
    }
    m.dispose();
  });
}

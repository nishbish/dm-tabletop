// The built-in 3D models a host app offers through `options.modelLibrary`: characters that stand on
// a token's base, and props (furniture and decorations) that are placed on the map. Files load on
// first use only, so a room without any downloads nothing.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneWithBones } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { joinAssetUrl } from './config';

export const PROP_PREFIX = 'prop:';

const FADE_SECONDS = 0.2;

export function createModelLibrary(options) {
  var library = options.modelLibrary || {};
  var characters = library.characters || [];
  var propFolders = library.props || [];
  var loader = new GLTFLoader();
  var models = new Map(); // file -> promise of the loaded glTF
  var materials = new Map(); // texture file -> shared material
  var props = new Map(); // prop id -> promise of its shared geometry and material

  function url(file) {
    return joinAssetUrl(options.assetBaseUrl, file);
  }

  function loadModel(file) {
    if (!models.has(file)) {
      models.set(file, loader.loadAsync(url(file)));
    }
    return models.get(file);
  }

  // One material per texture: the cheapest kind that takes the viewer's lights, and the same one the
  // token pictures use, so everything on the table is lit alike.
  function materialFor(file) {
    if (!materials.has(file)) {
      var texture = new THREE.TextureLoader().load(url(file));
      texture.flipY = false; // glTF texture coordinates start at the top
      texture.magFilter = THREE.NearestFilter;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      materials.set(file, new THREE.MeshPhongMaterial({ map: texture, shininess: 0 }));
    }
    return materials.get(file);
  }

  function findProp(id) {
    for (const folder of propFolders) {
      var found = folder.items.find(function (item) {
        return item.id === id;
      });
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  // All of a prop in one mesh, standing on z = 0 and centred, as a map image lies on its xy plane.
  // That makes a prop one shared geometry, moved, turned and resized by the map image handles.
  function bakeProp(gltf, item) {
    var parts = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(function (object) {
      if (object.isMesh) {
        var part = object.geometry.clone().applyMatrix4(object.matrixWorld);
        Object.keys(part.attributes).forEach(function (name) {
          if (!['position', 'normal', 'uv'].includes(name)) {
            part.deleteAttribute(name);
          }
        });
        parts.push(part.index ? part.toNonIndexed() : part);
      }
    });

    var geometry = parts.length > 1 ? mergeGeometries(parts) : parts[0];
    geometry.rotateX(Math.PI / 2);
    geometry.computeBoundingBox();

    var box = geometry.boundingBox;
    var longest = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
    var scale = (item.size || 1) / longest;
    geometry.scale(scale, scale, scale);
    geometry.computeBoundingBox();

    geometry.translate(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, -box.min.z);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    // what the resize handles read from a map image's plane geometry
    geometry.parameters = { width: box.max.x - box.min.x, height: box.max.y - box.min.y };
    return geometry;
  }

  return {
    hasProps: propFolders.length > 0,
    propFolders: propFolders,
    characterFolder: characters.length > 0 ? library.characterFolder || '3D Characters' : null,
    characters: characters,

    thumb: function (item) {
      return url(item.thumb);
    },

    character: function (id) {
      return characters.find(function (item) {
        return item.id === id;
      });
    },

    prop: findProp,

    // A new copy of a character, its feet at y = 0 and `size` times its usual height.
    createCharacter: async function (item, size) {
      var gltf = await loadModel(item.file);
      var object = cloneWithBones(gltf.scene);
      var material = materialFor(item.texture);

      object.traverse(function (child) {
        if (child.isMesh) {
          child.material = material;
        }
      });

      var box = new THREE.Box3().setFromObject(gltf.scene);
      var scale = (item.height * size) / (box.max.y - box.min.y);
      object.scale.setScalar(scale);
      object.position.y = -box.min.y * scale;

      var body = new THREE.Group();
      body.add(object);

      var mixer = new THREE.AnimationMixer(object);
      var clip = function (name) {
        return gltf.animations.find(function (animation) {
          return animation.name === name;
        });
      };
      var idle = mixer.clipAction(clip('idle') || gltf.animations[0]);
      var walk = mixer.clipAction(clip('walk') || gltf.animations[0]);
      idle.time = Math.random() * idle.getClip().duration; // so a group does not move as one
      idle.play();
      mixer.update(0);

      return { body, mixer, idle, walk, height: item.height * size };
    },

    createProp: function (item) {
      if (!props.has(item.id)) {
        props.set(
          item.id,
          loadModel(item.file).then(function (gltf) {
            return { geometry: bakeProp(gltf, item), material: materialFor(item.texture) };
          }),
        );
      }
      return props.get(item.id);
    },

    setWalking: function (character, walking) {
      var from = walking ? character.idle : character.walk;
      var to = walking ? character.walk : character.idle;
      to.reset().play();
      from.crossFadeTo(to, FADE_SECONDS, false);
    },
  };
}

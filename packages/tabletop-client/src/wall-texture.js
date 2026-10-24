// Optional picture on the walls. The wall geometry has no texture coordinates, so they are made
// here from the vertex positions: each triangle is projected onto the plane it faces most (top,
// or one of the two vertical directions), one texture tile per `tileSize` world units. The
// picture is described by options.wallTexture = { src, tileSize }, `src` being loaded like a
// skybox face (relative to assetBaseUrl unless it is an absolute URL or a data URI).

import * as THREE from 'three';
import { joinAssetUrl } from './config';

export function addWallUvs(geometry, tileSize) {
  var source = geometry.index ? geometry.toNonIndexed() : geometry;
  var position = source.attributes.position;
  var uv = new Float32Array(position.count * 2);
  var a = [0, 0, 0];
  var b = [0, 0, 0];
  var c = [0, 0, 0];
  var k = 1 / (tileSize || 1);

  for (var i = 0; i + 2 < position.count; i += 3) {
    var p = [a, b, c];
    for (var v = 0; v < 3; v++) {
      p[v][0] = position.getX(i + v);
      p[v][1] = position.getY(i + v);
      p[v][2] = position.getZ(i + v);
    }
    // face normal (absolute components decide the projection)
    var ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2];
    var vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    var nx = Math.abs(uy * vz - uz * vy);
    var ny = Math.abs(uz * vx - ux * vz);
    var nz = Math.abs(ux * vy - uy * vx);

    for (var j = 0; j < 3; j++) {
      var q = p[j];
      var s, t;
      if (ny >= nx && ny >= nz) {
        s = q[0];
        t = q[2];
      } else if (nx >= nz) {
        s = q[2];
        t = q[1];
      } else {
        s = q[0];
        t = q[1];
      }
      uv[(i + j) * 2] = s * k;
      uv[(i + j) * 2 + 1] = t * k;
    }
  }

  source.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return source;
}

// The material for the walls: a plain grey, or the picture from options.wallTexture.
export function createWallMaterial(options) {
  var config = options.wallTexture;

  if (!config || !config.src) {
    return new THREE.MeshPhongMaterial({ color: 0x868f8c });
  }

  var src = /^(https?:|data:|blob:)/i.test(config.src)
    ? config.src
    : joinAssetUrl(options.assetBaseUrl, config.src);
  var texture = new THREE.TextureLoader().load(src);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;

  return new THREE.MeshPhongMaterial({ color: 0xffffff, map: texture });
}

export function wallTileSize(options) {
  var config = options.wallTexture;

  return config && config.tileSize > 0 ? config.tileSize : 2;
}

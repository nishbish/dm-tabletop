// Sky for the scene. By default two plain gradients (day and night) are drawn on the fly, so no
// image files are needed. A host app that has its own six-face skyboxes can describe them with
// options.skybox = { day: { path: 'skyboxes/day/sky', extension: '.png' }, night: {...} }; the
// faces are loaded from <assetBaseUrl>/<path>_<ft|bk|up|dn|rt|lf><extension> (.tga is supported).

import { joinAssetUrl } from './config';

var SIDES = ['ft', 'bk', 'up', 'dn', 'rt', 'lf'];

function gradientTexture(THREE, stops) {
  var canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  var context = canvas.getContext('2d');
  var gradient = context.createLinearGradient(0, 0, 0, 256);

  stops.forEach(function (stop) {
    gradient.addColorStop(stop[0], stop[1]);
  });
  context.fillStyle = gradient;
  context.fillRect(0, 0, 4, 256);

  return new THREE.CanvasTexture(canvas);
}

function proceduralSky(THREE, top, horizon, ground) {
  var side = gradientTexture(THREE, [
    [0, top],
    [1, horizon],
  ]);
  var up = gradientTexture(THREE, [
    [0, top],
    [1, top],
  ]);
  var down = gradientTexture(THREE, [
    [0, ground],
    [1, ground],
  ]);

  // same face order as the image skybox: ft, bk, up, dn, rt, lf
  return [side, side, up, down, side, side].map(function (texture) {
    return skyMaterial(THREE, texture);
  });
}

// The sky box follows the camera and is drawn first without writing depth, so it never hides
// anything: the map stays visible out to the camera's far plane, not just to the box's sides.
function skyMaterial(THREE, texture) {
  return new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, depthWrite: false });
}

function imageSky(THREE, TGALoader, options, config) {
  var extension = config.extension || '.png';

  return SIDES.map(function (side) {
    var loader = extension === '.tga' ? new TGALoader() : new THREE.TextureLoader();
    var texture = loader.load(
      joinAssetUrl(options.assetBaseUrl, config.path + '_' + side + extension),
    );

    return skyMaterial(THREE, texture);
  });
}

export function createSkyboxMaterials(THREE, TGALoader, options) {
  var config = options.skybox || {};

  return {
    day: config.day
      ? imageSky(THREE, TGALoader, options, config.day)
      : proceduralSky(THREE, '#3d7bc9', '#bcd8f2', '#4a4a4a'),
    night: config.night
      ? imageSky(THREE, TGALoader, options, config.night)
      : proceduralSky(THREE, '#070b1f', '#1f2b52', '#14141a'),
  };
}

// Look of doors and of the map building previews. Every door shares the same geometries,
// materials and texture, so a map with fifty doors costs the GPU no more memory than a map with one.
// Shared objects are flagged with userData.shared so disposeObject() leaves them alone.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const DOOR_SIZE = {
  width: 1,
  height: 2,
  frameThickness: 0.12,
  frameDepth: 0.28, // a little deeper than a wall, so the frame covers the cut wall ends
  thresholdDepth: 0.01,
};

let parts = null;

function shared(object) {
  object.userData.shared = true;
  return object;
}

// Wooden planks with two iron straps, drawn once on a small canvas (no image to download).
function plankTexture() {
  var canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  var ctx = canvas.getContext('2d');
  var tones = ['#6b4a2b', '#5c3f24', '#74512f', '#614427', '#6d4b2b'];
  var plankWidth = canvas.width / tones.length;
  // fixed pseudo-random sequence: every door and every visitor gets the same grain
  var seed = 7;
  var random = function () {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  for (var i = 0; i < tones.length; i++) {
    var x = i * plankWidth;
    ctx.fillStyle = tones[i];
    ctx.fillRect(x, 0, plankWidth, canvas.height);

    //grain
    ctx.strokeStyle = 'rgba(30, 18, 8, 0.18)';
    ctx.lineWidth = 1;
    for (var g = 0; g < 5; g++) {
      var gx = x + 3 + random() * (plankWidth - 6);
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.bezierCurveTo(gx + 2, 80, gx - 2, 170, gx + 1, canvas.height);
      ctx.stroke();
    }

    //seam
    ctx.fillStyle = '#2e1f12';
    ctx.fillRect(x, 0, 2, canvas.height);
  }

  //iron straps with a rivet on each plank
  for (const y of [46, 196]) {
    ctx.fillStyle = '#38383a';
    ctx.fillRect(0, y, canvas.width, 14);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(0, y, canvas.width, 2);

    ctx.fillStyle = '#5a5a5e';
    for (var r = 0; r < tones.length; r++) {
      ctx.beginPath();
      ctx.arc(r * plankWidth + plankWidth / 2, y + 7, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  var texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return shared(texture);
}

export function getDoorParts() {
  if (parts) {
    return parts;
  }

  var s = DOOR_SIZE;

  //frame: a stone frame around the opening
  var shape = new THREE.Shape()
    .moveTo(0, 0)
    .lineTo(0, s.height)
    .lineTo(s.width, s.height)
    .lineTo(s.width, 0)
    .lineTo(0, 0);

  shape.holes.push(
    new THREE.Path()
      .moveTo(s.frameThickness, s.thresholdDepth)
      .lineTo(s.frameThickness, s.height - s.frameThickness)
      .lineTo(s.width - s.frameThickness, s.height - s.frameThickness)
      .lineTo(s.width - s.frameThickness, s.thresholdDepth)
      .lineTo(s.frameThickness, s.thresholdDepth),
  );

  var frameGeometry = new THREE.ExtrudeGeometry(shape, {
    steps: 1,
    depth: s.frameDepth,
    bevelEnabled: false,
  });
  frameGeometry.translate(-(s.width / 2), -(s.height / 2), -(s.frameDepth / 2));

  //panel: hangs from the top of the frame, a hair narrower than the opening
  var panelWidth = s.width - s.frameThickness * 2 - 0.02;
  var panelHeight = s.height - s.frameThickness - s.thresholdDepth;
  var panelGeometry = new THREE.BoxGeometry(panelWidth, panelHeight, 0.08);
  panelGeometry.translate(0, -(s.frameThickness - s.thresholdDepth) / 2, 0);

  //ring handle on both faces, merged so it is one draw call; on the side away from the hinge
  var rings = [];
  for (const z of [0.05, -0.05]) {
    var ring = new THREE.TorusGeometry(0.055, 0.012, 6, 16);
    ring.translate(-(panelWidth / 2) + 0.12, -0.05, z);
    rings.push(ring);
  }
  var handleGeometry = mergeGeometries(rings);
  rings.forEach(function (ring) {
    ring.dispose();
  });

  parts = {
    frameGeometry: shared(frameGeometry),
    panelGeometry: shared(panelGeometry),
    handleGeometry: shared(handleGeometry),
    frameMaterial: shared(new THREE.MeshLambertMaterial({ color: 0x7a746c })),
    panelMaterial: shared(new THREE.MeshLambertMaterial({ map: plankTexture() })),
    handleMaterial: shared(new THREE.MeshLambertMaterial({ color: 0x2a2a2c })),
    // previews of what a click or drag will build
    ghostMaterial: shared(
      new THREE.MeshBasicMaterial({
        color: 0x7fb3ff,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    ),
  };

  return parts;
}

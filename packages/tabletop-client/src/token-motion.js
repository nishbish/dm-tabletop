// Small movements for the flat token pictures: a slow sway, a lean into the direction of travel and
// a hop when a token stops. Only the picture mesh moves. The token, its base and its vision mesh stay
// where they are, so nothing here touches the server, collisions, selection or fog.

const SWAY_ANGLE = 0.02; // radians, about one degree each way
const SWAY_SPEED = 1.4; // radians per second, one sway takes about 4.5 s
const BREATH = 0.012; // share of the height
const BREATH_SPEED = 1.9;
const LEAN_PER_UNIT = 0.16; // radians per grid square of recent sideways travel
const MAX_LEAN = 0.24;
const LEAN_FOLLOW = 12; // how fast the lean catches up, per second
const FORGET_TRAVEL = 6; // how fast recent travel is forgotten, per second
const STOPPED = 0.06; // recent travel below this counts as standing still
const MOVING = 0.15; // recent travel above this counts as moving
const JUMP = 6; // a move this long in one frame is a teleport, not a walk
const HOP_TIME = 0.26; // seconds
const HOP_HEIGHT = 0.1; // grid squares
const SQUASH = 0.07; // share of the height, on landing
const MAX_STEP = 0.1; // seconds, so a stalled frame does not fling anything

export function startPictureMotion(mesh, height) {
  mesh.userData.motion = {
    restX: mesh.position.x,
    restY: mesh.position.y,
    height: height,
    phase: Math.random() * Math.PI * 2,
    sideways: 0, // recent travel along the picture, signed
    travel: 0, // recent travel in any direction
    lean: 0,
    moving: false,
    hop: HOP_TIME, // seconds into the hop; HOP_TIME means no hop is running
    lastX: null,
    lastZ: null,
  };
}

// One step of the state, given how far the token moved since the last step. `along` is the part of
// that move along the picture (positive to the picture's right), `distance` the whole of it.
export function stepMotion(motion, along, distance, seconds) {
  var dt = Math.min(seconds, MAX_STEP);
  var keep = Math.exp(-FORGET_TRAVEL * dt);

  motion.sideways = (motion.sideways + along) * keep;
  motion.travel = (motion.travel + distance) * keep;

  // Grid-snapped tokens arrive in jumps, so the lean follows the remembered travel, not the speed.
  var target = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, -motion.sideways * LEAN_PER_UNIT));
  motion.lean += (target - motion.lean) * (1 - Math.exp(-LEAN_FOLLOW * dt));

  if (motion.travel > MOVING) {
    motion.moving = true;
  } else if (motion.moving && motion.travel < STOPPED) {
    motion.moving = false;
    motion.hop = 0;
  }

  if (motion.hop < HOP_TIME) {
    motion.hop = Math.min(HOP_TIME, motion.hop + dt);
  }
}

// The picture's pose at `time` (seconds): rotation about its feet, stretch of its height, lift.
export function motionPose(motion, time) {
  var hop = motion.hop / HOP_TIME;
  var running = hop < 1;
  var lift = running ? Math.sin(hop * Math.PI) * HOP_HEIGHT : 0;
  var squash = running ? Math.sin(hop * Math.PI * 2) * SQUASH * -1 : 0;

  return {
    angle: Math.sin(time * SWAY_SPEED + motion.phase) * SWAY_ANGLE + motion.lean,
    stretch: 1 + Math.sin(time * BREATH_SPEED + motion.phase) * BREATH + squash,
    lift: lift,
  };
}

function applyPose(mesh, motion, pose) {
  var half = (motion.height * pose.stretch) / 2;

  mesh.rotation.z = pose.angle;
  mesh.scale.set(1 / pose.stretch, pose.stretch, 1);
  // keeps the feet where they are, the picture turns around them and not around its middle
  mesh.position.x = motion.restX - Math.sin(pose.angle) * half;
  mesh.position.y = motion.restY - motion.height / 2 + Math.cos(pose.angle) * half + pose.lift;
}

export function updateTokenMotion(tokens, seconds, time) {
  for (const token of Object.values(tokens)) {
    var picture = token.meshes && token.meshes.picture;
    if (!picture || !token.visible) {
      continue;
    }

    var motion = picture.userData.motion;
    var x = token.position.x;
    var z = token.position.z;
    var dx = motion.lastX === null ? 0 : x - motion.lastX;
    var dz = motion.lastZ === null ? 0 : z - motion.lastZ;
    motion.lastX = x;
    motion.lastZ = z;

    var distance = Math.hypot(dx, dz);
    if (distance >= JUMP) {
      dx = 0;
      dz = 0;
      distance = 0;
    }

    // the first column of the matrix is the picture's right-hand direction in the world
    var e = token.matrixWorld.elements;
    var width = Math.hypot(e[0], e[2]) || 1;
    stepMotion(motion, (dx * e[0] + dz * e[2]) / width, distance, seconds);
    applyPose(picture, motion, motionPose(motion, time));
  }
}

// Back to a plain picture, for when the graphics setting turns the motion off.
export function resetTokenMotion(tokens) {
  for (const token of Object.values(tokens)) {
    var picture = token.meshes && token.meshes.picture;
    if (!picture) {
      continue;
    }

    var motion = picture.userData.motion;
    picture.rotation.z = 0;
    picture.scale.set(1, 1, 1);
    picture.position.x = motion.restX;
    picture.position.y = motion.restY;
    motion.sideways = 0;
    motion.travel = 0;
    motion.lean = 0;
    motion.moving = false;
    motion.hop = HOP_TIME;
    motion.lastX = null;
    motion.lastZ = null;
  }
}

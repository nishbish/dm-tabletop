// How a 3D character follows its token: it turns to face the way it goes, walks while it travels,
// and glides over the jumps between grid squares. Only the character moves; the token, its base and
// its vision stay exactly where the server says.

const FORGET_TRAVEL = 6; // how fast recent travel is forgotten, per second
const STOPPED = 0.06; // recent travel below this counts as standing still
const MOVING = 0.15; // recent travel above this counts as moving
const JUMP = 6; // a move this long in one frame is a teleport, not a walk
const TURN_SPEED = 10; // how fast it turns, per second
const GLIDE_SPEED = 12; // how fast it catches up with its token, per second
const MAX_STEP = 0.1; // seconds, so a stalled frame does not fling anything

export function newCharacterMotion() {
  return {
    facing: 0,
    target: 0,
    travel: 0,
    walking: false,
    offsetX: 0,
    offsetZ: 0,
    lastX: null,
    lastZ: null,
  };
}

// Turning the short way round, from any angle to any other.
export function turnTowards(angle, target, amount) {
  var difference = ((target - angle + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (difference < -Math.PI) {
    difference += Math.PI * 2;
  }
  return angle + difference * amount;
}

// One step, given where the token is now. Returns true when the character starts or stops walking.
export function stepCharacterMotion(motion, x, z, seconds) {
  var dt = Math.min(seconds, MAX_STEP);
  var dx = motion.lastX === null ? 0 : x - motion.lastX;
  var dz = motion.lastZ === null ? 0 : z - motion.lastZ;
  motion.lastX = x;
  motion.lastZ = z;

  var distance = Math.hypot(dx, dz);
  if (distance >= JUMP) {
    motion.offsetX = 0;
    motion.offsetZ = 0;
  } else if (distance > 0) {
    motion.target = Math.atan2(dx, dz);
    motion.travel += distance;
    motion.offsetX -= dx;
    motion.offsetZ -= dz;
  }

  motion.travel *= Math.exp(-FORGET_TRAVEL * dt);
  var keep = Math.exp(-GLIDE_SPEED * dt);
  motion.offsetX *= keep;
  motion.offsetZ *= keep;
  motion.facing = turnTowards(motion.facing, motion.target, 1 - Math.exp(-TURN_SPEED * dt));

  var walking = motion.walking ? motion.travel >= STOPPED : motion.travel > MOVING;
  var changed = walking !== motion.walking;
  motion.walking = walking;
  return changed;
}

export function updateCharacters(tokens, seconds, setWalking) {
  for (const token of Object.values(tokens)) {
    var character = token.meshes && token.meshes.character;
    if (!character) {
      continue;
    }

    var motion = character.motion;
    if (stepCharacterMotion(motion, token.position.x, token.position.z, seconds)) {
      setWalking(character, motion.walking);
    }

    character.body.rotation.y = motion.facing;
    character.body.position.x = motion.offsetX;
    character.body.position.z = motion.offsetZ;
    if (token.visible) {
      character.mixer.update(Math.min(seconds, MAX_STEP));
    }
  }
}

// Back to standing still at its token, for when the graphics setting turns the motion off.
export function resetCharacters(tokens, setWalking) {
  for (const token of Object.values(tokens)) {
    var character = token.meshes && token.meshes.character;
    if (character) {
      if (character.motion.walking) {
        setWalking(character, false);
      }
      character.motion.walking = false;
      character.motion.travel = 0;
      character.motion.offsetX = 0;
      character.motion.offsetZ = 0;
      character.motion.lastX = null;
      character.motion.lastZ = null;
      character.body.position.x = 0;
      character.body.position.z = 0;
    }
  }
}

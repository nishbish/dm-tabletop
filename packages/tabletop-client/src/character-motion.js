// How a 3D character follows its token: it turns to face the way it goes and plays its walk while it
// travels. It always stands on its base: trailing behind it looked like the two had come apart.
//
// Standing about, it does not idle all the time: it rests (holds still) for a while, then idles for
// a while, each on its own clock so a crowd does not sway in step. Resting and off-screen characters
// are not animated at all, which is most of their cost.

const FORGET_TRAVEL = 6; // how fast recent travel is forgotten, per second
const STOPPED = 0.06; // recent travel below this counts as standing still
const MOVING = 0.15; // recent travel above this counts as moving
const JUMP = 6; // a move this long in one frame is a teleport, not a walk
const TURN_SPEED = 10; // how fast it turns, per second
const MAX_STEP = 0.1; // seconds, so a stalled frame does not fling anything
const REST_SECONDS = [4, 12]; // how long it holds still, at least and at most
const IDLE_SECONDS = [3, 6]; // how long it idles before resting again

function between(range, random) {
  return range[0] + (range[1] - range[0]) * random();
}

export function newCharacterMotion(random = Math.random) {
  var resting = random() < 0.5;
  return {
    facing: 0,
    target: 0,
    travel: 0,
    walking: false,
    lastX: null,
    lastZ: null,
    resting: resting,
    // a part of the first spell only, so characters placed together soon fall out of step
    phase: between(resting ? REST_SECONDS : IDLE_SECONDS, random) * random(),
  };
}

// Counts down the current rest or idle spell and starts the next. Walking always counts as idling:
// it ends a rest at once, and it is followed by a full idle spell.
export function stepRest(motion, seconds, random = Math.random) {
  if (motion.walking) {
    motion.resting = false;
    motion.phase = between(IDLE_SECONDS, random);
    return;
  }

  motion.phase -= seconds;
  if (motion.phase <= 0) {
    motion.resting = !motion.resting;
    motion.phase = between(motion.resting ? REST_SECONDS : IDLE_SECONDS, random);
  }
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
  if (distance > 0 && distance < JUMP) {
    motion.target = Math.atan2(dx, dz);
    motion.travel += distance;
  }

  motion.travel *= Math.exp(-FORGET_TRAVEL * dt);
  motion.facing = turnTowards(motion.facing, motion.target, 1 - Math.exp(-TURN_SPEED * dt));

  var walking = motion.walking ? motion.travel >= STOPPED : motion.travel > MOVING;
  var changed = walking !== motion.walking;
  motion.walking = walking;
  return changed;
}

// `onScreen(token)` says whether a token can be seen from the camera; one that cannot is not
// animated (it still turns and starts or stops walking, so it looks right when it comes into view).
export function updateCharacters(tokens, seconds, setWalking, onScreen) {
  for (const token of Object.values(tokens)) {
    var character = token.meshes && token.meshes.character;
    if (!character) {
      continue;
    }

    var motion = character.motion;
    if (stepCharacterMotion(motion, token.position.x, token.position.z, seconds)) {
      setWalking(character, motion.walking);
    }

    stepRest(motion, Math.min(seconds, MAX_STEP));

    character.body.rotation.y = motion.facing;
    if (token.visible && !motion.resting && (!onScreen || onScreen(token))) {
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
      character.motion.lastX = null;
      character.motion.lastZ = null;
    }
  }
}

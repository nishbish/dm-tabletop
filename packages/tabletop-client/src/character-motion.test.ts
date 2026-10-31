import { describe, expect, it } from 'vitest';
import { newCharacterMotion, stepCharacterMotion, turnTowards } from './character-motion.js';

const FRAME = 1 / 60;

function walkTo(motion: ReturnType<typeof newCharacterMotion>, x: number, z: number, frames = 30) {
  const startX = motion.lastX ?? 0;
  const startZ = motion.lastZ ?? 0;
  let changes = 0;
  for (let i = 1; i <= frames; i++) {
    const t = i / frames;
    if (stepCharacterMotion(motion, startX + (x - startX) * t, startZ + (z - startZ) * t, FRAME)) {
      changes++;
    }
  }
  return changes;
}

function rest(motion: ReturnType<typeof newCharacterMotion>, frames = 120) {
  let changes = 0;
  for (let i = 0; i < frames; i++) {
    if (stepCharacterMotion(motion, motion.lastX ?? 0, motion.lastZ ?? 0, FRAME)) changes++;
  }
  return changes;
}

describe('character motion', () => {
  it('stands still until its token moves', () => {
    const motion = newCharacterMotion();
    stepCharacterMotion(motion, 3, 4, FRAME);
    expect(rest(motion)).toBe(0);
    expect(motion.walking).toBe(false);
  });

  it('walks while travelling and stops afterwards', () => {
    const motion = newCharacterMotion();
    stepCharacterMotion(motion, 0, 0, FRAME);
    expect(walkTo(motion, 3, 0)).toBe(1);
    expect(motion.walking).toBe(true);
    expect(rest(motion)).toBe(1);
    expect(motion.walking).toBe(false);
  });

  it('turns to face the way it goes', () => {
    const motion = newCharacterMotion();
    stepCharacterMotion(motion, 0, 0, FRAME);
    walkTo(motion, 3, 0);
    rest(motion);
    expect(motion.facing).toBeCloseTo(Math.PI / 2, 2);
    walkTo(motion, 3, -3);
    rest(motion);
    expect(Math.cos(motion.facing)).toBeCloseTo(-1, 2);
  });

  it('turns the short way round', () => {
    expect(turnTowards(3, -3, 0.5)).toBeGreaterThan(3); // through pi, not back through 0
    expect(turnTowards(-3, 3, 0.5)).toBeLessThan(-3);
  });

  it('glides over a jump to the next grid square', () => {
    const motion = newCharacterMotion();
    stepCharacterMotion(motion, 0, 0, FRAME);
    stepCharacterMotion(motion, 1, 0, FRAME);
    expect(motion.offsetX).toBeLessThan(-0.5); // still drawn behind its token
    rest(motion);
    expect(Math.abs(motion.offsetX)).toBeLessThan(0.001);
  });

  it('does not walk across the map on a teleport', () => {
    const motion = newCharacterMotion();
    stepCharacterMotion(motion, 0, 0, FRAME);
    expect(stepCharacterMotion(motion, 40, 0, FRAME)).toBe(false);
    expect(motion.offsetX).toBe(0);
  });

  it('survives a stalled frame', () => {
    const motion = newCharacterMotion();
    stepCharacterMotion(motion, 0, 0, FRAME);
    stepCharacterMotion(motion, 1, 0, 30);
    expect(Number.isFinite(motion.facing)).toBe(true);
    expect(Number.isFinite(motion.offsetX)).toBe(true);
  });
});

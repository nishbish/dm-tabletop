import { describe, expect, it } from 'vitest';
import {
  newCharacterMotion,
  stepCharacterMotion,
  stepRest,
  turnTowards,
  updateCharacters,
} from './character-motion.js';

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

  it('stays on its base: nothing about it trails behind its token', () => {
    const motion = newCharacterMotion();
    stepCharacterMotion(motion, 0, 0, FRAME);
    stepCharacterMotion(motion, 1, 0, FRAME);
    expect(Object.keys(motion)).not.toContain('offsetX');
  });

  it('does not walk across the map on a teleport', () => {
    const motion = newCharacterMotion();
    stepCharacterMotion(motion, 0, 0, FRAME);
    expect(stepCharacterMotion(motion, 40, 0, FRAME)).toBe(false);
    expect(motion.travel).toBe(0);
  });

  it('survives a stalled frame', () => {
    const motion = newCharacterMotion();
    stepCharacterMotion(motion, 0, 0, FRAME);
    stepCharacterMotion(motion, 1, 0, 30);
    expect(Number.isFinite(motion.facing)).toBe(true);
    expect(Number.isFinite(motion.travel)).toBe(true);
  });

  it('rests and idles in turns while standing, each spell a few seconds', () => {
    const motion = newCharacterMotion(() => 0.5);
    const spells: boolean[] = [motion.resting];
    for (let i = 0; i < 60 * 60; i++) {
      stepRest(motion, FRAME, () => 0.5);
      if (motion.resting !== spells[spells.length - 1]) spells.push(motion.resting);
    }
    // a minute: rests of 8 s and idles of 4.5 s take turns
    expect(spells.length).toBeGreaterThan(6);
    expect(spells.length).toBeLessThan(12);
    for (let i = 1; i < spells.length; i++) expect(spells[i]).toBe(!spells[i - 1]);
  });

  it('never rests while walking, and idles for a while after', () => {
    const motion = newCharacterMotion(() => 0);
    motion.resting = true;
    motion.walking = true;
    stepRest(motion, FRAME, () => 0);
    expect(motion.resting).toBe(false);
    motion.walking = false;
    stepRest(motion, 1, () => 0);
    expect(motion.resting).toBe(false);
  });

  it('does not animate a character that is resting or off screen', () => {
    const updates: string[] = [];
    const token = (id: string, resting: boolean) => ({
      position: { x: 0, z: 0 },
      visible: true,
      meshes: {
        character: {
          body: { rotation: { y: 0 } },
          mixer: { update: () => updates.push(id) },
          motion: { ...newCharacterMotion(() => 0), resting, phase: 100 },
        },
      },
    });
    const tokens = {
      a: token('idling', false),
      b: token('resting', true),
      c: token('off screen', false),
    };
    updateCharacters(
      tokens,
      FRAME,
      () => {},
      (t: unknown) => t !== tokens.c,
    );
    expect(updates).toEqual(['idling']);
  });
});

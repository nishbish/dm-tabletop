import { describe, expect, it } from 'vitest';
import {
  motionPose,
  resetTokenMotion,
  startPictureMotion,
  stepMotion,
  updateTokenMotion,
} from './token-motion.js';

const FRAME = 1 / 60;

function fakeMesh(x = 0, y = 1) {
  return {
    position: { x, y },
    rotation: { z: 0 },
    scale: {
      x: 1,
      y: 1,
      set(a: number, b: number) {
        this.x = a;
        this.y = b;
      },
    },
    userData: {} as { motion?: ReturnType<typeof newMotion> },
  };
}

function newMotion() {
  const mesh = fakeMesh();
  startPictureMotion(mesh, 2);
  return mesh.userData.motion as {
    lean: number;
    hop: number;
    phase: number;
    moving: boolean;
    lastX: number | null;
  };
}

function fakeToken(mesh: ReturnType<typeof fakeMesh>) {
  return {
    visible: true,
    position: { x: 0, z: 0 },
    // a token that faces the default way: its right-hand side is +x in the world
    matrixWorld: { elements: [1, 0, 0, 0] },
    meshes: { picture: mesh },
  };
}

describe('token picture motion', () => {
  it('leans into the direction of travel and settles again', () => {
    const motion = newMotion();
    for (let i = 0; i < 30; i++) stepMotion(motion, 0.1, 0.1, FRAME);
    expect(motion.lean).toBeLessThan(-0.05); // to the right is a clockwise, negative angle
    for (let i = 0; i < 180; i++) stepMotion(motion, 0, 0, FRAME);
    expect(Math.abs(motion.lean)).toBeLessThan(0.01);
  });

  it('never leans further than the limit, even for a long fast drag', () => {
    const motion = newMotion();
    for (let i = 0; i < 300; i++) stepMotion(motion, 3, 3, FRAME);
    expect(Math.abs(motion.lean)).toBeLessThanOrEqual(0.24);
  });

  it('hops once when a token stops, and not before it has moved', () => {
    const still = newMotion();
    for (let i = 0; i < 60; i++) stepMotion(still, 0, 0, FRAME);
    expect(motionPose(still, 0).lift).toBe(0);

    const motion = newMotion();
    stepMotion(motion, 1, 1, FRAME);
    let highest = 0;
    let hops = 0;
    let wasLifted = false;
    for (let i = 0; i < 180; i++) {
      stepMotion(motion, 0, 0, FRAME);
      const lift = motionPose(motion, 0).lift;
      highest = Math.max(highest, lift);
      if (lift > 0 && !wasLifted) hops++;
      wasLifted = lift > 0;
    }
    expect(hops).toBe(1);
    expect(highest).toBeGreaterThan(0.05);
    expect(motionPose(motion, 0).lift).toBe(0);
  });

  it('survives a stalled frame', () => {
    const motion = newMotion();
    stepMotion(motion, 1, 1, 30);
    expect(Number.isFinite(motion.lean)).toBe(true);
    expect(Math.abs(motion.lean)).toBeLessThanOrEqual(0.24);
  });

  it('keeps the feet in place while the picture turns', () => {
    const mesh = fakeMesh(0.25, 1);
    const token = fakeToken(mesh);
    startPictureMotion(mesh, 2);
    updateTokenMotion([token], FRAME, 3);

    const angle = mesh.rotation.z;
    const half = mesh.scale.y; // the height is 2
    const feetX = mesh.position.x + Math.sin(angle) * half;
    const feetY = mesh.position.y - Math.cos(angle) * half;
    expect(angle).not.toBe(0);
    expect(feetX).toBeCloseTo(0.25, 6);
    expect(feetY).toBeCloseTo(0, 6);
  });

  it('treats a teleport as no movement', () => {
    const mesh = fakeMesh();
    const token = fakeToken(mesh);
    startPictureMotion(mesh, 2);
    updateTokenMotion([token], FRAME, 0);
    token.position.x = 40;
    updateTokenMotion([token], FRAME, 0);
    expect(mesh.userData.motion?.moving).toBe(false);
  });

  it('leaves hidden tokens and tokens without a picture alone', () => {
    const mesh = fakeMesh();
    const token = fakeToken(mesh);
    startPictureMotion(mesh, 2);
    token.visible = false;
    updateTokenMotion([token, { visible: true, meshes: {} }, { visible: true }], FRAME, 3);
    expect(mesh.rotation.z).toBe(0);
  });

  it('puts a picture back exactly when the motion is turned off', () => {
    const mesh = fakeMesh(0.25, 1);
    const token = fakeToken(mesh);
    startPictureMotion(mesh, 2);
    updateTokenMotion([token], FRAME, 3);
    resetTokenMotion([token]);
    expect(mesh.position).toEqual({ x: 0.25, y: 1 });
    expect(mesh.rotation.z).toBe(0);
    expect([mesh.scale.x, mesh.scale.y]).toEqual([1, 1]);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any -- a recording stand-in for a canvas */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFog } from './fog.js';

interface Call {
  name: string;
  args: unknown[];
}

// A canvas whose 2D context only records what is drawn on it.
function fakeCanvas() {
  const calls: Call[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
    };
  const context: any = {
    calls,
    filter: 'none',
    fillStyle: '',
    globalCompositeOperation: 'source-over',
  };
  for (const name of [
    'setTransform',
    'clearRect',
    'fillRect',
    'save',
    'restore',
    'beginPath',
    'moveTo',
    'lineTo',
    'closePath',
    'fill',
    'drawImage',
  ])
    context[name] = record(name);
  return { width: 0, height: 0, getContext: () => context, context } as any;
}

let canvases: any[];

beforeEach(() => {
  canvases = [];
  vi.stubGlobal('document', {
    createElement: () => {
      const c = fakeCanvas();
      canvases.push(c);
      return c;
    },
  });
});

function triangles(fog: any): number {
  return fog.mesh.geometry.getAttribute('position').count / 3;
}

function bounds(fog: any) {
  const p = fog.mesh.geometry.getAttribute('position');
  const box = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  };
  for (let i = 0; i < p.count; i++) {
    box.minX = Math.min(box.minX, p.getX(i));
    box.maxX = Math.max(box.maxX, p.getX(i));
    box.minY = Math.min(box.minY, p.getY(i));
    box.maxY = Math.max(box.maxY, p.getY(i));
    box.minZ = Math.min(box.minZ, p.getZ(i));
    box.maxZ = Math.max(box.maxZ, p.getZ(i));
  }
  return box;
}

describe('fog of war', () => {
  it('keeps three small layers for the grid, never more than 2048 pixels a side', () => {
    createFog(30, 20);
    expect(canvases).toHaveLength(3);
    expect(canvases[0].width).toBe(30 * 16);
    expect(canvases[0].height).toBe(20 * 16);
    canvases = [];
    createFog(400, 400);
    expect(canvases[0].width).toBeLessThanOrEqual(2048);
  });

  it('is a slab over the grid, as strong as material.opacity says', () => {
    const fog = createFog(10, 8);
    const box = bounds(fog);
    expect(box.minX).toBeCloseTo(-0.5);
    expect(box.maxX).toBeCloseTo(9.5);
    expect(box.minZ).toBeCloseTo(-0.5);
    expect(box.maxZ).toBeCloseTo(7.5);
    // sides from below the floor (walls stand on -0.5) up to the top, so it cannot be seen under
    expect(box.minY).toBeLessThan(-0.5);
    expect(box.maxY).toBeGreaterThan(1.5);
    // top (2 triangles) and the skirt round the map (4 sides x 2 triangles), no curtains yet
    expect(triangles(fog)).toBe(2 + 8);
    fog.material.opacity = 0.6;
    fog.update(1000);
    expect(fog.material.uniforms.uStrength.value).toBe(0.6);
    fog.material.opacity = 0;
    fog.update(1100);
    expect(fog.mesh.visible).toBe(false);
  });

  it('draws what a token sees onto the visible and explored layers, in pixels', () => {
    const fog = createFog(10, 10);
    fog.setVision([
      { x: 0, z: 0 },
      { x: 4, z: 0 },
      { x: 4, z: 4 },
    ]);
    const visible = canvases[0].context.calls.filter(
      (c: Call) => c.name === 'moveTo' || c.name === 'lineTo',
    );
    // the map starts half a cell before cell 0: x = 0 is at 0.5 cell = 8 px
    expect(visible[0].args).toEqual([8, 8]);
    expect(visible[1].args).toEqual([72, 8]);
    const explored = canvases[2].context.calls.filter((c: Call) => c.name === 'moveTo');
    expect(explored).toHaveLength(1);
  });

  it('fades the old view out over about half a second and remembers what was seen', () => {
    const fog = createFog(10, 10);
    const t0 = performance.now() + 10;
    fog.update(t0);
    fog.setVision([
      { x: 1, z: 1 },
      { x: 3, z: 1 },
      { x: 3, z: 3 },
    ]);
    expect(fog.material.uniforms.uMix.value).toBe(1); // not yet updated
    fog.update(t0 + 100);
    expect(fog.material.uniforms.uMix.value).toBeGreaterThan(0);
    expect(fog.material.uniforms.uMix.value).toBeLessThan(1);
    for (let i = 2; i <= 6; i++) fog.update(t0 + i * 100);
    expect(fog.material.uniforms.uMix.value).toBe(1);
    // looking elsewhere does not make the explored layer forget (it is only ever added to)
    const clears = () =>
      canvases[2].context.calls.filter((c: Call) => c.name === 'fillRect').length;
    const before = clears();
    fog.setVision([
      { x: 6, z: 6 },
      { x: 8, z: 6 },
      { x: 8, z: 8 },
    ]);
    expect(clears()).toBe(before);
    expect(canvases[2].context.globalCompositeOperation).toBeDefined();
  });

  it('simple fog uses the flat shader and half-size layers, keeping what was seen', () => {
    const fog = createFog(10, 10);
    expect(canvases[0].width).toBe(160);
    fog.setSimple(true);
    expect('FOG_SIMPLE' in fog.material.defines).toBe(true);
    expect(canvases).toHaveLength(6);
    expect(canvases[3].width).toBe(80);
    expect(canvases[5].context.calls.some((c: Call) => c.name === 'drawImage')).toBe(true);
    fog.setVision([
      { x: 0, z: 0 },
      { x: 4, z: 0 },
      { x: 4, z: 4 },
    ]);
    const moves = canvases[3].context.calls.filter((c: Call) => c.name === 'moveTo');
    expect(moves[0].args).toEqual([4, 4]);
    fog.setSimple(false);
    expect('FOG_SIMPLE' in fog.material.defines).toBe(false);
    expect(canvases[6].width).toBe(160);
  });

  it('stands a curtain of fog just outside each edge of the view, facing the fog behind it', () => {
    const fog = createFog(10, 10);
    // a square seen around (4, 4), wound either way round
    for (const square of [
      [
        { x: 3, z: 3 },
        { x: 5, z: 3 },
        { x: 5, z: 5 },
        { x: 3, z: 5 },
      ],
      [
        { x: 3, z: 3 },
        { x: 3, z: 5 },
        { x: 5, z: 5 },
        { x: 5, z: 3 },
      ],
    ]) {
      fog.setVision(square);
      expect(triangles(fog)).toBe(2 + 8 + 4 * 2);
      const p = fog.mesh.geometry.getAttribute('position');
      const s = fog.mesh.geometry.getAttribute('aSample');
      // the curtains are the 24 vertices before the top's 6; each stands outside the square and reads further out
      for (let i = p.count - 30; i < p.count - 6; i++) {
        const outside = Math.max(Math.abs(p.getX(i) - 4), Math.abs(p.getZ(i) - 4));
        expect(outside).toBeGreaterThan(1);
        const ax = p.getX(i) + s.getX(i);
        const az = p.getZ(i) + s.getY(i);
        expect(Math.max(Math.abs(ax - 4), Math.abs(az - 4))).toBeGreaterThan(outside);
      }
    }
    // looking away (no view) takes the curtains down again
    fog.setVision([]);
    expect(triangles(fog)).toBe(2 + 8);
  });

  it('leaves the edges of the view that run along the edge of the map to the skirt', () => {
    const fog = createFog(10, 10);
    fog.setVision([
      { x: -0.49, z: -0.49 },
      { x: 9.49, z: -0.49 },
      { x: 4, z: 4 },
    ]);
    expect(triangles(fog)).toBe(2 + 8 + 2 * 2);
  });

  it('reset forgets everything seen', () => {
    const fog = createFog(10, 10);
    fog.setVision([
      { x: 1, z: 1 },
      { x: 3, z: 1 },
      { x: 3, z: 3 },
    ]);
    const before = canvases[2].context.calls.filter((c: Call) => c.name === 'fillRect').length;
    fog.reset();
    expect(triangles(fog)).toBe(2 + 8);
    expect(canvases[2].context.calls.filter((c: Call) => c.name === 'fillRect').length).toBe(
      before + 1,
    );
  });
});

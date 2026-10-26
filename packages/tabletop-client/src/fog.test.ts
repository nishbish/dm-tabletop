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

  it('is a flat plane over the grid, as strong as material.opacity says', () => {
    const fog = createFog(10, 8);
    expect(fog.mesh.position.x).toBeCloseTo(4.5);
    expect(fog.mesh.position.z).toBeCloseTo(3.5);
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

  it('reset forgets everything seen', () => {
    const fog = createFog(10, 10);
    fog.setVision([
      { x: 1, z: 1 },
      { x: 3, z: 1 },
      { x: 3, z: 3 },
    ]);
    const before = canvases[2].context.calls.filter((c: Call) => c.name === 'fillRect').length;
    fog.reset();
    expect(canvases[2].context.calls.filter((c: Call) => c.name === 'fillRect').length).toBe(
      before + 1,
    );
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any -- a recording stand-in for a canvas */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { attachDepth, createFog, OVERLAY_LAYER } from './fog.js';

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

  it('is a screen pass after the scene, as strong as material.opacity says', () => {
    const fog = createFog(10, 8);
    expect(fog.pass.material).toBe(fog.material);
    expect(fog.material.uniforms.uGrid.value.toArray()).toEqual([10, 8]);
    // no planes in the scene: the shader walks each view ray through the volume
    expect(fog.material.fragmentShader).toContain('tDepth');
    fog.update(1000);
    expect(fog.material.uniforms.uStrength.value).toBe(1);
    // a player sees nothing of what was explored before
    expect(fog.material.uniforms.uVeil.value).toBe(0);
    fog.material.opacity = 0.6;
    fog.update(1050);
    expect(fog.material.uniforms.uStrength.value).toBe(0.6);
    // the host's translucent view shows explored ground through a thinner veil
    expect(fog.material.uniforms.uVeil.value).toBe(1);
    // the clear view costs nothing: the pass is skipped
    expect(fog.pass.enabled).toBe(true);
    fog.material.opacity = 0;
    fog.update(1100);
    expect(fog.pass.enabled).toBe(false);
  });

  it('gives the composer a depth texture to read on both of its targets', () => {
    const composer: any = {
      renderTarget1: new THREE.WebGLRenderTarget(64, 32),
      renderTarget2: new THREE.WebGLRenderTarget(64, 32),
    };
    attachDepth(composer);
    expect(composer.renderTarget1.depthTexture).toBeInstanceOf(THREE.DepthTexture);
    expect(composer.renderTarget2.depthTexture).toBeInstanceOf(THREE.DepthTexture);
    expect(composer.renderTarget1.depthTexture).not.toBe(composer.renderTarget2.depthTexture);
    const first = composer.renderTarget1.depthTexture;
    attachDepth(composer);
    expect(composer.renderTarget1.depthTexture).toBe(first);
  });

  it('draws the overlay layer after the fog only while something on it is showing', () => {
    const fog = createFog(4, 4);
    const camera = new THREE.PerspectiveCamera(36, 1.5, 1, 1000);
    const scene = new THREE.Scene();
    let showing = false;
    fog.setOverlay(scene, () => showing);
    fog.update(performance.now() + 1, camera);
    const renders: number[] = [];
    const renderer: any = {
      autoClear: true,
      setRenderTarget: () => {},
      render: () => renders.push(camera.layers.mask),
    };
    const target: any = { texture: {}, depthTexture: {} };
    fog.pass.render(renderer, target, target);
    // just the fog itself (drawn with its own camera)
    expect(renders).toHaveLength(1);
    showing = true;
    fog.pass.render(renderer, target, target);
    expect(renders).toHaveLength(3);
    expect(renders[2]).toBe(1 << OVERLAY_LAYER);
    // the camera and the renderer are left as they were
    expect(camera.layers.mask).toBe(1);
    expect(renderer.autoClear).toBe(true);
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

  it('carries a view that reaches the edge of the map on past it, so no fog lines the edge', () => {
    const fog = createFog(10, 10);
    // standing at (2, 5), seeing up to the left edge (x = -0.5) and round into the top-left corner
    fog.setVision(
      [
        { x: -0.5, z: 7 },
        { x: -0.5, z: 2 },
        { x: 1, z: -0.5 },
        { x: 4, z: -0.5 },
        { x: 4, z: 7 },
      ],
      { x: 2, z: 5 },
    );
    const points = canvases[0].context.calls
      .filter((c: Call) => c.name === 'moveTo' || c.name === 'lineTo')
      .map((c: Call) => c.args as number[]);
    // the two points on the left edge and the two on the top edge end up well outside the canvas
    expect(points[0][0]).toBeLessThan(-8);
    expect(points[1][0]).toBeLessThan(-8);
    // along the line of sight: the point down at z = 7 stays below the token, the one at z = 2 above
    expect(points[0][1]).toBeGreaterThan(5.5 * 16);
    expect(points[1][1]).toBeLessThan(5.5 * 16);
    // the top-left corner is added between the left edge and the top edge
    expect(points[2][0]).toBeLessThan(-8);
    expect(points[2][1]).toBeLessThan(-8);
    expect(points[3][1]).toBeLessThan(-8);
    expect(points[4][1]).toBeLessThan(-8);
    // a point inside the map is untouched
    expect(points[5]).toEqual([4.5 * 16, 7.5 * 16]);
    expect(points).toHaveLength(6);
  });

  it('adds no corner between opposite edges, or along one edge', () => {
    const fog = createFog(10, 10);
    fog.setVision(
      [
        { x: -0.5, z: 2 },
        { x: -0.5, z: 6 },
        { x: 9.5, z: 6 },
        { x: 9.5, z: 2 },
      ],
      { x: 5, z: 4 },
    );
    const count = canvases[0].context.calls.filter(
      (c: Call) => c.name === 'moveTo' || c.name === 'lineTo',
    ).length;
    expect(count).toBe(4);
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

  it('simple fog takes fewer, longer steps, half-size layers and no swirls, keeping what was seen', () => {
    const fog = createFog(10, 10);
    expect(canvases[0].width).toBe(160);
    const steps = fog.material.defines.FOG_STEPS;
    fog.setSimple(true);
    expect(fog.material.defines.FOG_STEPS).toBeLessThan(steps);
    // and plain black, with no swirls
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
    expect(fog.material.defines.FOG_STEPS).toBe(steps);
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

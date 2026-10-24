import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addWallUvs, createWallMaterial, wallTileSize } from './wall-texture.js';

describe('wall texture', () => {
  it('gives every vertex a texture coordinate, one tile per tileSize units', () => {
    // a 4 x 2 wall face standing in the xy plane, facing +z
    const g = new THREE.PlaneGeometry(4, 2);
    const out = addWallUvs(g, 2);
    const uv = out.attributes.uv;
    expect(uv.count).toBe(out.attributes.position.count);
    const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
    const vs = Array.from({ length: uv.count }, (_, i) => uv.getY(i));
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(2); // 4 units / 2
    expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(1); // 2 units / 2
  });

  it('projects a top face onto the ground plane', () => {
    const g = new THREE.PlaneGeometry(2, 6);
    g.rotateX(-Math.PI / 2); // lying down, facing up
    const out = addWallUvs(g, 1);
    const vs = Array.from({ length: out.attributes.uv.count }, (_, i) => out.attributes.uv.getY(i));
    expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(6);
  });

  it('keeps the plain grey wall without a picture', () => {
    const material = createWallMaterial({ assetBaseUrl: '' } as never) as THREE.MeshPhongMaterial;
    expect(material.map).toBeNull();
    expect(wallTileSize({} as never)).toBe(2);
    expect(wallTileSize({ wallTexture: { src: 'a.jpg', tileSize: 3 } } as never)).toBe(3);
  });
});

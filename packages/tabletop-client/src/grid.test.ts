import { describe, expect, it } from 'vitest';
import {
  HEX_RADIUS,
  HEX_ROW,
  createHexGrid,
  gridCellKey,
  gridShape,
  hexCenter,
  hexCorners,
  hexSnapCandidates,
  snapHex,
} from './grid';

const close = (p: { x: number; z: number }, x: number, z: number) => {
  expect(p.x).toBeCloseTo(x, 6);
  expect(p.z).toBeCloseTo(z, 6);
};

describe('gridShape', () => {
  it('is square unless the room says hex', () => {
    expect(gridShape('hex')).toBe('hex');
    expect(gridShape('square')).toBe('square');
    expect(gridShape(undefined)).toBe('square');
    expect(gridShape('triangle')).toBe('square');
  });
});

describe('hexCenter', () => {
  it('puts hex (0, 0) where square (0, 0) is, and odd rows half a unit over', () => {
    close(hexCenter(0, 0), 0, 0);
    close(hexCenter(0.3, 0.1), 0, 0);
    close(hexCenter(0.5, HEX_ROW), 0.5, HEX_ROW);
    close(hexCenter(2.1, 2 * HEX_ROW), 2, 2 * HEX_ROW);
    close(hexCenter(-0.4, 0), 0, 0);
  });

  it('finds the hex every point lies in: nearer that centre than any other', () => {
    for (let i = 0; i < 2000; i++) {
      const x = Math.sin(i * 12.9898) * 40 + 20;
      const z = Math.cos(i * 78.233) * 40 + 20;
      const c = hexCenter(x, z);
      const d = Math.hypot(c.x - x, c.z - z);
      expect(d).toBeLessThanOrEqual(HEX_RADIUS + 1e-9);
      // a neighbouring centre is never nearer
      for (const n of [
        [1, 0],
        [-1, 0],
        [0.5, HEX_ROW],
        [-0.5, HEX_ROW],
        [0.5, -HEX_ROW],
        [-0.5, -HEX_ROW],
      ]) {
        expect(Math.hypot(c.x + n[0] - x, c.z + n[1] - z)).toBeGreaterThanOrEqual(d - 1e-9);
      }
    }
  });

  it('keeps hexes one unit (5 feet) across, so distances match the square grid', () => {
    const c = hexCorners({ x: 0, z: 0 });
    expect(c[1].x - c[5].x).toBeCloseTo(1, 9); // flat side to flat side
    expect(Math.hypot(0.5, HEX_ROW)).toBeCloseTo(1, 9); // centre to neighbouring centre
  });
});

describe('snapHex', () => {
  it('puts odd sizes in the middle of a hex and even sizes on a corner', () => {
    close(snapHex(0.2, 0.1), 0, 0);
    close(snapHex(0.1, -0.4, true), 0, -HEX_RADIUS);
    close(snapHex(0.45, 0.25, true), 0.5, HEX_RADIUS / 2);
  });

  it('does not move a token that is already snapped', () => {
    const centre = snapHex(7.3, 4.4);
    close(snapHex(centre.x, centre.z), centre.x, centre.z);
    const corner = snapHex(7.3, 4.4, true);
    close(snapHex(corner.x, corner.z, true), corner.x, corner.z);
  });
});

describe('hexSnapCandidates', () => {
  it('starts with the snapped hex, then its neighbours nearest first', () => {
    const list = hexSnapCandidates(5.2, 5.1, false, 20, 20);
    close(list[0], hexCenter(5.2, 5.1).x, hexCenter(5.2, 5.1).z);
    expect(list).toHaveLength(7);
    for (let i = 2; i < list.length; i++) {
      expect(Math.hypot(list[i].x - 5.2, list[i].z - 5.1)).toBeGreaterThanOrEqual(
        Math.hypot(list[i - 1].x - 5.2, list[i - 1].z - 5.1) - 1e-9,
      );
    }
  });

  it('never snaps a token off the map', () => {
    // odd rows reach the right edge at width - 0.5: the hex on the edge is skipped
    const list = hexSnapCandidates(9.45, HEX_ROW, false, 10, 10);
    for (const p of list) expect(p.x).toBeLessThanOrEqual(9.5);
    close(list[0], 8.5, HEX_ROW); // the next hex along the same row
    expect(hexSnapCandidates(0, 0, false, 10, 10).every((p) => p.x >= -0.5 && p.z >= -0.5)).toBe(
      true,
    );
  });

  it('offers the corner and the corners one edge from it for even sizes', () => {
    const list = hexSnapCandidates(5.1, 5.2, true, 20, 20);
    expect(list.length).toBe(4);
    for (const p of list.slice(1)) {
      expect(Math.hypot(p.x - list[0].x, p.z - list[0].z)).toBeCloseTo(HEX_RADIUS, 5);
    }
  });

  it('rounds away floating point noise', () => {
    const p = hexSnapCandidates(3, 3 * HEX_ROW, false, 20, 20)[0];
    expect(String(p.z).length).toBeLessThanOrEqual(10);
  });
});

describe('gridCellKey', () => {
  it('changes when a token crosses into the next row of hexes', () => {
    // both points truncate to (0, 0), so the square key alone would miss this move
    expect(gridCellKey('square', 0.1, 0.1)).toBe(gridCellKey('square', 0.4, 0.9));
    expect(gridCellKey('hex', 0.1, 0.1)).not.toBe(gridCellKey('hex', 0.4, 0.9));
    expect(gridCellKey('hex', 0.1, 0.1)).toBe(gridCellKey('hex', -0.1, 0.2));
  });
});

describe('createHexGrid', () => {
  it('is one rectangle over the whole map, whatever its size, that ignores raycasts', () => {
    const mesh = createHexGrid(1000, 1000);
    expect(mesh.geometry.attributes.position.count).toBe(4);
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    expect([box.min.x, box.max.x, box.min.z, box.max.z]).toEqual([-0.5, 999.5, -0.5, 999.5]);
    const hits = [];
    mesh.raycast(null, hits);
    expect(hits).toHaveLength(0);
  });
});

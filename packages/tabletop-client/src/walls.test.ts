import { describe, expect, it } from 'vitest';
import {
  wallPieces,
  wallTiles,
  buildWallArrays,
  corridorWalls,
  doorCutKey,
  doorInterval,
  roomOutline,
  snapDoorToWalls,
  wallSegments,
} from './walls';

const boxCount = (arrays: { indices: Uint32Array }) => arrays.indices.length / 30;

describe('walls', () => {
  it('skips zero-length segments', () => {
    expect(
      wallSegments([
        { x: 0, z: 0 },
        { x: 0, z: 0 },
        { x: 2, z: 0 },
      ]),
    ).toHaveLength(1);
  });

  it('builds one box per segment', () => {
    const arrays = buildWallArrays(
      [
        { x: 0, z: 0 },
        { x: 4, z: 0 },
        { x: 4, z: 3 },
      ],
      [],
      new Set(),
    );
    expect(boxCount(arrays)).toBe(2);
    expect(arrays.positions.length).toBe(2 * 20 * 3);
  });

  it('cuts an opening where a door sits in the wall', () => {
    const points = [
      { x: 0.5, z: 0.5 },
      { x: 6.5, z: 0.5 },
    ];
    const door = { x: 3, z: 0.5, rotation: 0, width: 1 };
    expect(doorInterval(door, wallSegments(points)[0])).toEqual([2, 3]);
    expect(boxCount(buildWallArrays(points, [door], new Set()))).toBe(2);
  });

  it('ignores doors that are across or beside a wall', () => {
    const seg = wallSegments([
      { x: 0, z: 0 },
      { x: 6, z: 0 },
    ])[0];
    expect(doorInterval({ x: 3, z: 0, rotation: Math.PI / 2, width: 1 }, seg)).toBeNull();
    expect(doorInterval({ x: 3, z: 1, rotation: 0, width: 1 }, seg)).toBeNull();
    // a door turned round still counts
    expect(doorInterval({ x: 3, z: 0, rotation: Math.PI, width: 1 }, seg)).toEqual([2.5, 3.5]);
  });

  it('only changes the cut key when openings change', () => {
    const points = [
      { x: 0, z: 0 },
      { x: 6, z: 0 },
    ];
    const a = doorCutKey(points, [{ x: 3, z: 0, rotation: 0, width: 1 }]);
    expect(doorCutKey(points, [{ x: 3, z: 5, rotation: 0, width: 1 }])).toBe('');
    expect(doorCutKey(points, [{ x: 4, z: 0, rotation: 0, width: 1 }])).not.toBe(a);
  });

  it('snaps a door into the nearest wall, on a whole square, lined up', () => {
    const segs = wallSegments([
      { x: 0.5, z: 0.5 },
      { x: 0.5, z: 8.5 },
    ]);
    const door = snapDoorToWalls(0.9, 3.3, segs, 1);
    expect(door.x).toBeCloseTo(0.5);
    expect(door.z).toBeCloseTo(3);
    expect(Math.abs(Math.cos(door.rotation))).toBeLessThan(1e-9);
    expect(snapDoorToWalls(4, 3, segs, 1)).toBeNull();
  });

  it('keeps a door inside short walls', () => {
    const segs = wallSegments([
      { x: 0, z: 0 },
      { x: 2, z: 0 },
    ]);
    expect(snapDoorToWalls(1.9, 0.1, segs, 1).x).toBeCloseTo(1.5);
  });

  it('drags out a closed room on grid lines', () => {
    const outline = roomOutline({ x: 1.2, z: 1.1 }, { x: 4.8, z: 3.9 });
    expect(outline[0]).toEqual({ x: 1.5, z: 1.5 });
    expect(outline[2]).toEqual({ x: 4.5, z: 3.5 });
    expect(outline[4]).toEqual(outline[0]);
    expect(roomOutline({ x: 1, z: 1 }, { x: 1.1, z: 4 })).toBeNull();
  });

  it('drags out a corridor with walls on grid lines', () => {
    const [left, right] = corridorWalls({ x: 0.2, z: 3.1 }, { x: 7.9, z: 3.4 }, 2);
    expect(left).toEqual([
      { x: 0.5, z: 2.5 },
      { x: 7.5, z: 2.5 },
    ]);
    expect(right[0].z - left[0].z).toBe(2);
  });

  it('splits wall pieces into whole model tiles that fill them exactly', () => {
    const pieces = wallPieces(
      [
        { x: 0, z: 0 },
        { x: 3.5, z: 0 },
      ],
      [{ x: 2, z: 0, rotation: 0, width: 1 }],
      new Set(),
    );
    // a door from 1.5 to 2.5 leaves 1.5 and 1 squares
    expect(pieces.map((p) => [p[0], p[2]])).toEqual([
      [0, 1.5],
      [2.5, 3.5],
    ]);
    const tiles = wallTiles(pieces, 1);
    expect(tiles.map((t) => t.length)).toEqual([0.75, 0.75, 1]);
    expect(tiles.map((t) => t.x)).toEqual([0.375, 1.125, 3]);
    expect(tiles[0].z).toBe(0);
    expect(tiles.reduce((sum, t) => sum + t.length, 0)).toBeCloseTo(2.5);
  });

  it('turns tiles along the wall, like a door in it', () => {
    const tiles = wallTiles([[0, 0, 0, 2, 0, 1]], 1);
    expect(tiles).toHaveLength(2);
    // the model's x axis (cos r, -sin r) must point along the wall (0, 1)
    expect(Math.cos(tiles[0].rotation)).toBeCloseTo(0);
    expect(-Math.sin(tiles[0].rotation)).toBeCloseTo(1);
    expect(wallTiles([[0, 0, 0.2, 0, 1, 0]], 1)).toHaveLength(1);
  });
});

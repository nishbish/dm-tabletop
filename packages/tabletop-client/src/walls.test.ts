import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  Blocker,
  WALL_THICKNESS,
  doorBlocker,
  insideBlocker,
  moveBlocked,
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

describe('wall faces', () => {
  const wallMesh = (points: { x: number; z: number }[]) => {
    const arrays = buildWallArrays(points, [], new Set());
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(arrays.indices, 1));
    return { arrays, mesh: new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()) };
  };

  it('winds every triangle to face the way its normal points (out of the box)', () => {
    const { arrays } = wallMesh([
      { x: 0, z: 0 },
      { x: 3, z: 0 },
      { x: 3, z: 2 },
    ]);
    const p = arrays.positions;
    const corner = (i: number) => new THREE.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);

    for (let i = 0; i < arrays.indices.length; i += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => corner(arrays.indices[i + k]));
      const facing = new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3());
      const n = arrays.indices[i] * 3;
      const normal = new THREE.Vector3(
        arrays.normals[n],
        arrays.normals[n + 1],
        arrays.normals[n + 2],
      );
      expect(facing.dot(normal)).toBeCloseTo(1);
    }
  });

  it('stops a ray from outside at the near face and lets one from inside out', () => {
    // a wall through the middle of the squares at x = 3
    const { mesh } = wallMesh([
      { x: 3, z: 0 },
      { x: 3, z: 10 },
    ]);
    const ray = new THREE.Raycaster();

    ray.set(new THREE.Vector3(1, 0, 5), new THREE.Vector3(1, 0, 0));
    const hits = ray.intersectObject(mesh);
    expect(hits[0].point.x).toBeCloseTo(3 - WALL_THICKNESS / 2);

    ray.set(new THREE.Vector3(3, 0, 5), new THREE.Vector3(1, 0, 0));
    expect(ray.intersectObject(mesh)).toHaveLength(0);
  });
});

describe('moveBlocked', () => {
  // a wall through the middle of the squares at x = 3, from z = 0.5 to z = 5
  const wall: Blocker[] = wallPieces(
    [
      { x: 3, z: 0.5 },
      { x: 3, z: 5 },
    ],
    [],
    new Set(),
  ).map((piece) => ({ piece, half: WALL_THICKNESS / 2 }));

  it('allows moves that stay clear of walls', () => {
    expect(moveBlocked({ x: 1, z: 2 }, { x: 2, z: 2 }, wall)).toBe(false);
    expect(moveBlocked({ x: 2, z: 2 }, { x: 2, z: 4 }, wall)).toBe(false);
    // round the free end of the wall
    expect(moveBlocked({ x: 2, z: 6 }, { x: 4, z: 6 }, wall)).toBe(false);
  });

  it('refuses a square whose centre is on the wall', () => {
    expect(moveBlocked({ x: 2, z: 2 }, { x: 3, z: 2 }, wall)).toBe(true);
    expect(moveBlocked({ x: 3, z: 6 }, { x: 3, z: 5 }, wall)).toBe(true);
    expect(moveBlocked({ x: 2.85, z: 2 }, { x: 2.95, z: 2 }, wall)).toBe(true);
  });

  it('refuses moves through a wall, diagonal ones included', () => {
    expect(moveBlocked({ x: 2, z: 2 }, { x: 4, z: 2 }, wall)).toBe(true);
    // the diagonal that slipped past the x and z rays of the viewer
    expect(moveBlocked({ x: 2, z: 0 }, { x: 4, z: 1 }, wall)).toBe(true);
  });

  it('lets a token already in a wall step out', () => {
    expect(moveBlocked({ x: 3, z: 2 }, { x: 4, z: 2 }, wall)).toBe(false);
    expect(moveBlocked({ x: 3, z: 2 }, { x: 2, z: 3 }, wall)).toBe(false);
  });

  it('blocks closed doors across their width', () => {
    // a door in a wall running along x, centred mid-square
    const door = doorBlocker({ x: 4, z: 3, rotation: 0, width: 1 }, 0.28);
    expect(moveBlocked({ x: 4, z: 2 }, { x: 4, z: 4 }, [door])).toBe(true);
    expect(moveBlocked({ x: 4, z: 2 }, { x: 4, z: 3 }, [door])).toBe(true);
    expect(moveBlocked({ x: 3, z: 2 }, { x: 3, z: 4 }, [door])).toBe(false);
  });

  it('puts the middle of a double door in both leaves', () => {
    // two one-square leaves centred on half squares, in a wall through the middle of the squares
    const left = doorBlocker({ x: 9.5, z: 18, rotation: 0, width: 1 }, 0.28);
    const right = doorBlocker({ x: 10.5, z: 18, rotation: 0, width: 1 }, 0.28);
    expect(insideBlocker({ x: 10, z: 18 }, left)).toBe(true);
    expect(insideBlocker({ x: 10, z: 18 }, right)).toBe(true);
    expect(insideBlocker({ x: 10, z: 17 }, left)).toBe(false);
  });
});

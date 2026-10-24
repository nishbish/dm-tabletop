// Wall geometry and door snapping, kept free of three.js and the DOM so it is cheap and easy to
// test. The viewer turns the arrays returned here into one BufferGeometry per wall group, so a
// wall of any length is a single draw call.

export interface Point {
  x: number;
  z: number;
}

export interface Segment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

export interface DoorSpan {
  x: number;
  z: number;
  rotation: number;
  width: number;
}

export interface WallArrays {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export const WALL_HEIGHT = 2;
export const WALL_THICKNESS = 0.2;
export const FLOOR_Y = -0.5;

// How far off a door may be from a wall (in squares, and in radians) and still count as being
// in it. Snapped doors are exact, so this only has to absorb float noise.
const ON_WALL_DISTANCE = 0.05;
const ON_WALL_ANGLE = 0.05;
const EPSILON = 1e-6;

// Same rounding the viewer uses for wall points: half squares.
export function snapHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

// Nearest grid line. Squares are centred on whole numbers, so the lines sit on the halves.
export function snapGridLine(value: number): number {
  return Math.round(value - 0.5) + 0.5;
}

export function pointKey(p: Point): string {
  return p.x + ',' + p.z;
}

export function wallSegments(points: Point[]): Segment[] {
  const segments: Segment[] = [];

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];

    if (a.x !== b.x || a.z !== b.z) {
      segments.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
    }
  }

  return segments;
}

// Direction a door's width runs along, for a three.js rotation about y.
function doorAxis(rotation: number): Point {
  return { x: Math.cos(rotation), z: -Math.sin(rotation) };
}

// The rotation that lines a door up with a wall running along (ux, uz).
export function rotationAlong(ux: number, uz: number): number {
  return Math.atan2(-uz, ux);
}

// The stretch of a segment a door covers, as distances from the segment start, or null when the
// door is not in this segment.
export function doorInterval(door: DoorSpan, seg: Segment): [number, number] | null {
  const dx = seg.bx - seg.ax;
  const dz = seg.bz - seg.az;
  const length = Math.hypot(dx, dz);

  if (length < EPSILON) {
    return null;
  }

  const ux = dx / length;
  const uz = dz / length;
  const axis = doorAxis(door.rotation);

  // parallel either way round (a door can face both sides of a wall)
  if (Math.abs(ux * axis.z - uz * axis.x) > ON_WALL_ANGLE) {
    return null;
  }

  const px = door.x - seg.ax;
  const pz = door.z - seg.az;

  if (Math.abs(px * uz - pz * ux) > ON_WALL_DISTANCE) {
    return null;
  }

  const along = px * ux + pz * uz;
  const half = door.width / 2;

  if (along + half <= EPSILON || along - half >= length - EPSILON) {
    return null;
  }

  return [Math.max(0, along - half), Math.min(length, along + half)];
}

// Pieces of a segment left once door openings are cut out, as distance pairs.
function solidPieces(length: number, cuts: [number, number][]): [number, number][] {
  cuts.sort((a, b) => a[0] - b[0]);

  const pieces: [number, number][] = [];
  let start = 0;

  for (const [from, to] of cuts) {
    if (from - start > EPSILON) {
      pieces.push([start, from]);
    }
    start = Math.max(start, to);
  }

  if (length - start > EPSILON) {
    pieces.push([start, length]);
  }

  return pieces;
}

// A cheap fingerprint of where doors cut a wall group, so the viewer only rebuilds a group's
// geometry when its openings actually changed.
export function doorCutKey(points: Point[], doors: DoorSpan[]): string {
  if (doors.length === 0) {
    return '';
  }

  const parts: string[] = [];
  const segments = wallSegments(points);

  for (let i = 0; i < segments.length; i++) {
    for (const door of doors) {
      const cut = doorInterval(door, segments[i]);

      if (cut) {
        parts.push(i + ':' + cut[0].toFixed(3) + '-' + cut[1].toFixed(3));
      }
    }
  }

  return parts.join('|');
}

// One box per solid wall piece, merged into flat arrays (no bottom faces: they are never seen).
// `joints` holds pointKey()s of positions where walls meet; wall ends there are stretched by half
// the thickness so corners are filled in. Free wall ends stop exactly at their point, as before.
export function buildWallArrays(
  points: Point[],
  doors: DoorSpan[],
  joints: Set<string>,
): WallArrays {
  const segments = wallSegments(points);
  const boxes: number[][] = [];
  const half = WALL_THICKNESS / 2;
  const closed =
    points.length > 2 &&
    points[0].x === points[points.length - 1].x &&
    points[0].z === points[points.length - 1].z;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const dx = seg.bx - seg.ax;
    const dz = seg.bz - seg.az;
    const length = Math.hypot(dx, dz);
    const ux = dx / length;
    const uz = dz / length;
    const cuts: [number, number][] = [];

    for (const door of doors) {
      const cut = doorInterval(door, seg);
      if (cut) {
        cuts.push(cut);
      }
    }

    const startJoint = i > 0 || closed || joints.has(pointKey({ x: seg.ax, z: seg.az }));
    const endJoint =
      i < segments.length - 1 || closed || joints.has(pointKey({ x: seg.bx, z: seg.bz }));

    for (const [from, to] of solidPieces(length, cuts)) {
      const s0 = from === 0 && startJoint ? -half : from;
      const s1 = to === length && endJoint ? length + half : to;
      boxes.push([seg.ax + ux * s0, seg.az + uz * s0, seg.ax + ux * s1, seg.az + uz * s1, ux, uz]);
    }
  }

  // 5 faces x 4 corners per box
  const positions = new Float32Array(boxes.length * 20 * 3);
  const normals = new Float32Array(boxes.length * 20 * 3);
  const indices = new Uint32Array(boxes.length * 30);
  const y0 = FLOOR_Y;
  const y1 = FLOOR_Y + WALL_HEIGHT;
  let v = 0;
  let n = 0;

  const face = (corners: number[][], nx: number, ny: number, nz: number) => {
    const base = v;

    for (const c of corners) {
      positions[v * 3] = c[0];
      positions[v * 3 + 1] = c[1];
      positions[v * 3 + 2] = c[2];
      normals[v * 3] = nx;
      normals[v * 3 + 1] = ny;
      normals[v * 3 + 2] = nz;
      v++;
    }

    indices.set([base, base + 1, base + 2, base, base + 2, base + 3], n);
    n += 6;
  };

  for (const [x0, z0, x1, z1, ux, uz] of boxes) {
    // side normal, pointing to the left of the wall direction
    const nx = -uz;
    const nz = ux;
    const ox = nx * half;
    const oz = nz * half;
    // the four bottom corners: start-left, end-left, end-right, start-right
    const sl = [x0 + ox, z0 + oz];
    const el = [x1 + ox, z1 + oz];
    const er = [x1 - ox, z1 - oz];
    const sr = [x0 - ox, z0 - oz];

    // corners are wound counter-clockwise seen from outside the box
    face(
      [
        [sl[0], y0, sl[1]],
        [sl[0], y1, sl[1]],
        [el[0], y1, el[1]],
        [el[0], y0, el[1]],
      ],
      nx,
      0,
      nz,
    );
    face(
      [
        [er[0], y0, er[1]],
        [er[0], y1, er[1]],
        [sr[0], y1, sr[1]],
        [sr[0], y0, sr[1]],
      ],
      -nx,
      0,
      -nz,
    );
    face(
      [
        [sr[0], y0, sr[1]],
        [sr[0], y1, sr[1]],
        [sl[0], y1, sl[1]],
        [sl[0], y0, sl[1]],
      ],
      -ux,
      0,
      -uz,
    );
    face(
      [
        [el[0], y0, el[1]],
        [el[0], y1, el[1]],
        [er[0], y1, er[1]],
        [er[0], y0, er[1]],
      ],
      ux,
      0,
      uz,
    );
    face(
      [
        [sl[0], y1, sl[1]],
        [sr[0], y1, sr[1]],
        [er[0], y1, er[1]],
        [el[0], y1, el[1]],
      ],
      0,
      1,
      0,
    );
  }

  return { positions, normals, indices };
}

// Where a door should go if it is dropped at (x, z): centred in the nearest wall within
// `maxDistance`, lined up with it, and on a whole square for straight walls. Returns null when no
// wall is close enough (the door then stays where it was dropped). `currentRotation` keeps the
// side a door opens to when it is already lined up with that wall.
export function snapDoorToWalls(
  x: number,
  z: number,
  segments: Segment[],
  width: number,
  currentRotation = 0,
  maxDistance = 0.75,
): DoorSpan | null {
  let best: DoorSpan | null = null;
  let bestDistance = maxDistance;

  for (const seg of segments) {
    const dx = seg.bx - seg.ax;
    const dz = seg.bz - seg.az;
    const length = Math.hypot(dx, dz);

    if (length < width - EPSILON) {
      continue;
    }

    const ux = dx / length;
    const uz = dz / length;
    const px = x - seg.ax;
    const pz = z - seg.az;
    const along = px * ux + pz * uz;

    if (along < -maxDistance || along > length + maxDistance) {
      continue;
    }

    let s: number;

    if (Math.abs(uz) < EPSILON) {
      s = (Math.round(seg.ax + ux * along) - seg.ax) * ux;
    } else if (Math.abs(ux) < EPSILON) {
      s = (Math.round(seg.az + uz * along) - seg.az) * uz;
    } else {
      s = snapHalf(along);
    }

    s = Math.min(Math.max(s, width / 2), length - width / 2);

    const sx = seg.ax + ux * s;
    const sz = seg.az + uz * s;
    const distance = Math.hypot(x - sx, z - sz);

    if (distance < bestDistance) {
      bestDistance = distance;
      const axis = doorAxis(currentRotation);
      const parallel = Math.abs(ux * axis.z - uz * axis.x) < ON_WALL_ANGLE;
      best = { x: sx, z: sz, rotation: parallel ? currentRotation : rotationAlong(ux, uz), width };
    }
  }

  return best;
}

// The closed outline of a rectangular room between two dragged corners, on grid lines.
export function roomOutline(a: Point, b: Point): Point[] | null {
  const x0 = snapGridLine(Math.min(a.x, b.x));
  const x1 = snapGridLine(Math.max(a.x, b.x));
  const z0 = snapGridLine(Math.min(a.z, b.z));
  const z1 = snapGridLine(Math.max(a.z, b.z));

  if (x1 - x0 < 1 || z1 - z0 < 1) {
    return null;
  }

  return [
    { x: x0, z: z0 },
    { x: x1, z: z0 },
    { x: x1, z: z1 },
    { x: x0, z: z1 },
    { x: x0, z: z0 },
  ];
}

// The two side walls of a straight corridor dragged from a to b, `width` squares wide. It runs
// along whichever axis the drag mostly follows, with both walls on grid lines.
export function corridorWalls(a: Point, b: Point, width: number): [Point[], Point[]] | null {
  const alongX = Math.abs(b.x - a.x) >= Math.abs(b.z - a.z);
  const offset = width / 2;
  // even widths centre on a grid line, odd ones mid-square, so both walls land on grid lines
  const centre = (v: number) => (width % 2 === 0 ? snapGridLine(v) : Math.round(v));

  if (alongX) {
    const x0 = snapGridLine(Math.min(a.x, b.x));
    const x1 = snapGridLine(Math.max(a.x, b.x));
    const c = centre(a.z);

    if (x1 - x0 < 1) {
      return null;
    }

    return [
      [
        { x: x0, z: c - offset },
        { x: x1, z: c - offset },
      ],
      [
        { x: x0, z: c + offset },
        { x: x1, z: c + offset },
      ],
    ];
  }

  const z0 = snapGridLine(Math.min(a.z, b.z));
  const z1 = snapGridLine(Math.max(a.z, b.z));
  const c = centre(a.x);

  if (z1 - z0 < 1) {
    return null;
  }

  return [
    [
      { x: c - offset, z: z0 },
      { x: c - offset, z: z1 },
    ],
    [
      { x: c + offset, z: z0 },
      { x: c + offset, z: z1 },
    ],
  ];
}

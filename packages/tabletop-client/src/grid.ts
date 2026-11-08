// The map's grid shape: squares or hexes.
//
// Hexes do not change the map's coordinates. A position is still x and z in grid units, a unit is
// still 5 feet, the map is still `width` by `height` units, and nothing stored in a room moves when
// the shape changes: the shape only decides what is drawn and where a dropped token snaps to.
// The hexes are "pointy-top" and exactly one unit across their flat sides, the usual 5-foot hex, so
// a token's size, view distance and anything else measured in units means the same on both grids.
//
// Hex centres: row r lies at z = r * HEX_ROW (rows are sqrt(3)/2 apart), its centres at whole x,
// and odd rows are pushed half a unit to the right. Hex (0, 0) has its centre at (0, 0), the same
// spot as square (0, 0), and the grid fills the same rectangle as the squares, from -0.5 to
// width - 0.5 (hexes on its edge are cut off by it).
//
// The grid is drawn by one shader on one rectangle (createHexGrid), so it costs the same on a
// 1000 x 1000 map as on a 10 x 10 one, instead of millions of line points.

import * as THREE from 'three';

export type GridShape = 'square' | 'hex';

export interface Point {
  x: number;
  z: number;
}

/** Distance between hex rows. */
export const HEX_ROW = Math.sqrt(3) / 2;
/** Centre to corner of a hex one unit across its flat sides. */
export const HEX_RADIUS = 1 / Math.sqrt(3);

const ROW_PAIR = Math.sqrt(3); // even rows repeat every two rows

/** Anything that is not 'hex' is a square grid, so rooms saved before hexes stay square. */
export function gridShape(value: unknown): GridShape {
  return value === 'hex' ? 'hex' : 'square';
}

/** The centre of the hex that contains (x, z). */
export function hexCenter(x: number, z: number): Point {
  // The centres are two rectangular lattices (even rows and odd rows); the nearest centre of
  // each is a plain rounding, and the nearer of the two is the hex the point lies in.
  const a = { x: Math.round(x), z: Math.round(z / ROW_PAIR) * ROW_PAIR };
  const b = {
    x: Math.floor(x) + 0.5,
    z: Math.round((z - HEX_ROW) / ROW_PAIR) * ROW_PAIR + HEX_ROW,
  };
  return dist2(a, x, z) <= dist2(b, x, z) ? a : b;
}

/** The six corners of the hex centred on `c`, starting at the top and going round. */
export function hexCorners(c: Point): Point[] {
  const r = HEX_RADIUS;
  return [
    { x: c.x, z: c.z - r },
    { x: c.x + 0.5, z: c.z - r / 2 },
    { x: c.x + 0.5, z: c.z + r / 2 },
    { x: c.x, z: c.z + r },
    { x: c.x - 0.5, z: c.z + r / 2 },
    { x: c.x - 0.5, z: c.z - r / 2 },
  ];
}

/** The six neighbouring hex centres of the hex centred on `c`. */
export function hexNeighbours(c: Point): Point[] {
  return [
    { x: c.x + 1, z: c.z },
    { x: c.x - 1, z: c.z },
    { x: c.x + 0.5, z: c.z + HEX_ROW },
    { x: c.x - 0.5, z: c.z + HEX_ROW },
    { x: c.x + 0.5, z: c.z - HEX_ROW },
    { x: c.x - 0.5, z: c.z - HEX_ROW },
  ];
}

/**
 * Where a token dropped at (x, z) snaps to on a hex grid. A token of odd size (1, 3, 5) sits on
 * the middle of a hex, as it sits in the middle of a square; an even size (2, 4, 6) sits on the
 * nearest hex corner, where three hexes meet, as on squares it sits where four squares meet.
 * The nearest corner is always a corner of the hex the point is in.
 */
export function snapHex(x: number, z: number, evenSize = false): Point {
  const c = hexCenter(x, z);
  if (!evenSize) return c;
  return nearest(hexCorners(c), x, z);
}

/**
 * The places a token dropped at (x, z) may snap to, best first: the snapped spot, then the spots
 * around it (the neighbouring hexes, or for an even size the corners around it), nearest to the
 * drop first. Spots on or outside the map's edge (`width` by `height`) are left out. The viewer takes the
 * first one that is not inside a wall.
 */
export function hexSnapCandidates(
  x: number,
  z: number,
  evenSize: boolean,
  width: number,
  height: number,
): Point[] {
  const seen = new Set<string>();
  const out: Point[] = [];
  const add = (p: Point) => {
    const key = cellKey(p);
    if (seen.has(key)) return;
    seen.add(key);
    // a spot on the map's edge would leave the token half off it
    const e = 1e-6;
    if (p.x <= -0.5 + e || p.z <= -0.5 + e || p.x >= width - 0.5 - e || p.z >= height - 0.5 - e)
      return;
    out.push(round(p));
  };
  const c = hexCenter(x, z);
  if (evenSize) {
    const corners = hexCorners(c);
    for (const n of [c].concat(hexNeighbours(c))) {
      for (const k of hexCorners(n)) corners.push(k);
    }
    // the corner the token snaps to, then the corners one edge away from it
    const first = nearest(corners, x, z);
    add(first);
    corners
      .filter((k) => Math.hypot(k.x - first.x, k.z - first.z) < HEX_RADIUS * 1.01)
      .sort((p, q) => dist2(p, x, z) - dist2(q, x, z))
      .forEach(add);
  } else {
    add(c);
    hexNeighbours(c)
      .sort((p, q) => dist2(p, x, z) - dist2(q, x, z))
      .forEach(add);
  }
  return out;
}

/**
 * A short name for the grid cell a position is in, so the viewer can tell when a dragged token
 * has moved into another cell (then it sends the move and updates the token's vision).
 */
export function gridCellKey(shape: GridShape, x: number, z: number): string {
  if (shape === 'hex') return cellKey(hexCenter(x, z));
  return Math.trunc(x) + ':' + Math.trunc(z);
}

function cellKey(p: Point): string {
  // half units across, rows down: whole numbers for every centre and corner
  return Math.round(p.x * 2) + ':' + Math.round((p.z / HEX_RADIUS) * 2);
}

// Positions are sent to the server and saved: no long tails of floating point noise.
function round(p: Point): Point {
  return { x: Math.round(p.x * 1e6) / 1e6, z: Math.round(p.z * 1e6) / 1e6 };
}

function dist2(p: Point, x: number, z: number): number {
  return (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
}

function nearest(points: Point[], x: number, z: number): Point {
  let best = points[0];
  for (const p of points) {
    if (dist2(p, x, z) < dist2(best, x, z)) best = p;
  }
  return best;
}

// ---- drawing ----

const vertexShader = [
  'varying vec2 vWorld;',
  'void main() {',
  '	vec4 world = modelMatrix * vec4(position, 1.0);',
  '	vWorld = world.xz;',
  '	gl_Position = projectionMatrix * viewMatrix * world;',
  '}',
].join('\n');

// For each pixel: the offset from the nearest hex centre (the nearer of the two rectangular
// lattices, as in hexCenter), then how far that is from the hex's edge, in pixels. A line about a
// pixel wide is drawn along the edges, and the whole grid fades out when the hexes get only a few
// pixels across, so a zoomed-out map does not turn into a grey mush.
const fragmentShader = [
  'uniform vec3 uColor;',
  'uniform float uOpacity;',
  'varying vec2 vWorld;',
  'const vec2 PAIR = vec2(1.0, 1.7320508);',
  'void main() {',
  '	vec2 h = PAIR * 0.5;',
  '	vec2 a = mod(vWorld, PAIR) - h;',
  '	vec2 b = mod(vWorld - h, PAIR) - h;',
  '	vec2 g = dot(a, a) < dot(b, b) ? a : b;',
  '	g = abs(g);',
  '	float d = max(g.x, dot(g, vec2(0.5, 0.8660254)));',
  // the size of a pixel on the floor here (not fwidth(d), which drops to nothing along the edge
  // itself, where d stops rising and starts falling, and made the lines look dashed)
  '	vec2 px = fwidth(vWorld);',
  '	float fw = max(0.5 * (px.x + px.y), 1e-5);',
  '	float line = clamp(1.0 - (0.5 - d) / fw, 0.0, 1.0);',
  '	float fade = 1.0 - smoothstep(0.12, 0.3, px.x + px.y);',
  '	float alpha = line * fade * uOpacity;',
  '	if (alpha <= 0.0) discard;',
  '	gl_FragColor = vec4(uColor, alpha);',
  '}',
].join('\n');

/**
 * A flat rectangle covering the map (`width` by `height` units, from -0.5) that draws the hex
 * lines. Lay it at the height the square grid uses. It never answers raycasts, so it cannot get in
 * the way of picking tokens or the floor.
 */
export function createHexGrid(width: number, height: number, color = 0x000000): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(width, height);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(width / 2 - 0.5, 0, height / 2 - 0.5);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 1 },
    },
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'hex grid';
  // first of the see-through things, so the fog and anything standing on the floor draw over it
  mesh.renderOrder = -1;
  mesh.raycast = () => {};
  return mesh;
}

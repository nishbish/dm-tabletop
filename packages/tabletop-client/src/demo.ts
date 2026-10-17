/* eslint-disable @typescript-eslint/no-explicit-any -- the room is a loosely typed object, like the server state */
// Offline demo room, drawn from scratch: two small rooms with doors, walls and a few default
// tokens. (The original demo embedded a map that used uploaded pictures.)
// Shape = the "room" object stateToRoom() produces.

export function createDemoRoom(): Record<string, any> {
  const wall = (id: number, group: string, x: number, z: number) => [
    String(id),
    { wallGroupId: group, position: { x, z } },
  ];
  const wallPoints = Object.fromEntries([
    // outer wall of a 14 x 10 building, with a gap for the front door at x 9..10
    wall(1, 'w1', 9, 18),
    wall(2, 'w1', 4, 18),
    wall(3, 'w1', 4, 8),
    wall(4, 'w1', 18, 8),
    wall(5, 'w1', 18, 18),
    wall(6, 'w1', 11, 18),
    // inner wall splitting the building in two rooms, with a gap for a door at z 12..13
    wall(7, 'w2', 11, 8),
    wall(8, 'w2', 11, 11.5),
    wall(9, 'w3', 11, 13.5),
    wall(10, 'w3', 11, 18),
  ]);
  const tokens = Object.fromEntries(
    [
      ['1', 'default-red', 6, 10],
      ['2', 'default-blue', 7, 12],
      ['3', 'default-green', 14, 10],
      ['4', 'default-purple', 15, 15],
    ].map(([id, modelId, x, z]) => [
      id,
      {
        modelId,
        position: { x, y: 0, z },
        scale: { x: 1, y: 1, z: 1 },
        owners: [],
        settings: { hideAvatar: false, disableCamLook: false },
      },
    ]),
  );
  return {
    name: 'Demo',
    dm: 'demo-user',
    daylight: 1,
    moonlight: 0,
    grid: { width: 30, height: 30 },
    clients: { 'demo-user': { name: 'You', live: true, connections: [] } },
    tokens,
    planes: {},
    doors: {
      '1': { position: { x: 10, z: 18 }, rotation: 0, open: false },
      '2': { position: { x: 11, z: 12.5 }, rotation: -Math.PI / 2, open: false },
    },
    wallPoints,
    models: [],
  };
}

// Plain interfaces shared by the whole server. Kept deliberately simple.

// Untrusted JSON object from a client.
export interface Args {
  [key: string]: unknown;
}

export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TokenState {
  modelId: string;
  position: Vec3;
  scale: Vec3;
  // User ids that may move this token (besides hosts).
  owners: string[];
  settings: { hideAvatar: boolean; disableCamLook: boolean };
}

export interface PlaneState {
  position: Vec2;
  scale: { x: number; y: number };
  rotation: number;
  image: string;
  planeUploadId: string;
}

export interface DoorState {
  position: Vec2;
  rotation: number;
  open: boolean;
}

export interface WallPointState {
  wallGroupId: string;
  position: Vec2;
}

// The world state of one room. `version` lets us migrate saved rooms later.
export interface RoomState {
  version: number;
  name: string;
  grid: { width: number; height: number };
  daylight: number;
  moonlight: number;
  // Next id the server will hand out (one counter for all entity kinds, so ids never collide).
  nextId: number;
  tokens: { [id: string]: TokenState };
  planes: { [id: string]: PlaneState };
  doors: { [id: string]: DoorState };
  wallPoints: { [id: string]: WallPointState };
}

export type Role = 'host' | 'player';

export interface AuthResult {
  userId: string;
  roomId: string;
  // If omitted, the server decides (default: host if the room is empty, player otherwise).
  role?: Role;
  name?: string;
}

export interface JoinInfo {
  roomId?: string;
}

// May return a promise. Return null to reject the connection.
export type AuthenticateFn = (
  token: string,
  request: import('http').IncomingMessage,
  join: JoinInfo,
) => AuthResult | null | Promise<AuthResult | null>;

export interface Logger {
  debug(message: string, fields?: object): void;
  info(message: string, fields?: object): void;
  warn(message: string, fields?: object): void;
  error(message: string, fields?: object): void;
}

export interface RoomStorage {
  loadRoom(id: string): Promise<RoomState | null>;
  saveRoom(id: string, state: RoomState): Promise<void>;
}

// Passed to the onJoin hook after a connection joined a room.
export interface JoinEvent {
  userId: string;
  name: string;
  roomId: string;
  role: Role;
  // How many connections this user has in the room, counting the new one (1 = first connection).
  connectionCount: number;
}

// Passed to the onLeave hook after a joined connection closed.
export interface LeaveEvent {
  userId: string;
  roomId: string;
  role: Role;
  // Connections this user still has in the same room (0 = they are gone from it).
  remainingConnectionsOfUser: number;
}

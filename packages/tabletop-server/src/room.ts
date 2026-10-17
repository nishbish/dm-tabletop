import type { WebSocket } from 'ws';
import { Args, Role, RoomState } from './types';

export interface Connection {
  socket: WebSocket;
  userId: string;
  name: string;
  role: Role;
}

// A room that is loaded in memory. Exists only while at least one connection is in it.
export interface Room {
  id: string;
  state: RoomState;
  connections: Set<Connection>;
  // Users promoted to host while this room is loaded (assignHost, or host by authentication).
  hosts: Set<string>;
  dirty: boolean;
  // Internal save bookkeeping (used by the server, not by handlers).
  dirtySince: number;
  timer: NodeJS.Timeout | null;
  saving: Promise<void>;
  connectionsOf(userId: string): Connection[];
}

export interface HandlerContext {
  kind: 'update' | 'request';
  name: string;
  args: Args;
  user: Connection;
  room: Room;
  // Reply to the sender only (use from requests).
  reply(args: object): void;
  // Send {type:"update", name, args, from} to the other members (and the sender if includeSelf).
  // `name` defaults to the event being handled.
  broadcast(args: object, options?: { includeSelf?: boolean; name?: string }): void;
  // Call after changing room.state so the room is saved (debounced).
  markDirty(): void;
}

// A handler validates args, checks permissions, changes state, and calls reply/broadcast.
// Throw HandlerError (from './validate') to send an error back to the sender.
export type Handler = (ctx: HandlerContext) => void | Promise<void>;

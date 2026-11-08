import { Args, TokenOverrides, TokenState } from './types';
import { Connection, Handler, HandlerContext, Room } from './room';
import {
  HandlerError,
  between,
  bool,
  color,
  idString,
  int,
  num,
  optionalEcho,
  pair,
  requireObject,
  str,
} from './validate';

// Hard cap per entity kind so a misbehaving host cannot grow a room's memory without limit.
const MAX_ENTITIES = 5000;
// The same for one token's owners, which take a client-chosen string each.
const MAX_TOKEN_OWNERS = 100;
const MAX_TOKEN_NAME = 100;
// Above the number validators' own limit nobody is keeping score any more.
const MAX_HP = 1000000;
const MAX_AC = 1000;
// The in-game clock counts minutes from midnight at the start of day 1, up to the end of day 600.
export const MINUTES_PER_DAY = 1440;
export const MAX_CLOCK = MINUTES_PER_DAY * 600 - 1;
// The weather a host can pick. 'clear' is also what a room without any weather shows.
export const WEATHERS = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog'];

function newId(room: Room, collection: object): string {
  if (Object.keys(collection).length >= MAX_ENTITIES) {
    throw new HandlerError('too many objects in this room');
  }
  const id = String(room.state.nextId);
  room.state.nextId += 1;
  return id;
}

function requireHost(ctx: HandlerContext): void {
  if (ctx.user.role !== 'host') throw new HandlerError('only the host can do that');
}

// Ids come from the client, and a plain object also answers to "__proto__" and "constructor":
// writing to what those return would change every object in the process. Own keys only.
function find<T>(collection: { [id: string]: T }, id: string, what: string): T {
  if (!Object.prototype.hasOwnProperty.call(collection, id)) {
    throw new HandlerError(`no such ${what}`);
  }
  return collection[id];
}

// Hosts may touch any token; players only tokens that list them as an owner.
function requireTokenAccess(ctx: HandlerContext, tokenId: string): TokenState {
  const token = find(ctx.room.state.tokens, tokenId, 'token');
  if (ctx.user.role !== 'host' && token.owners.indexOf(ctx.user.userId) === -1) {
    throw new HandlerError('you do not own that token');
  }
  return token;
}

// Common shape of "change something, tell the others". Broadcast goes out immediately; we never
// delay position updates (clients throttle if they want to). `echo` is what the others receive.
function changed(ctx: HandlerContext, echo: object): void {
  ctx.markDirty();
  ctx.broadcast(echo);
}

// Every field is optional; only the ones sent are stored. The limits are the ones a picture's own
// settings have in the hosted app.
function tokenOverrides(a: Args): TokenOverrides {
  const out: TokenOverrides = {};
  if (a.name !== undefined) {
    const name = str(a, 'name')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim();
    if (!name || name.length > MAX_TOKEN_NAME) {
      throw new HandlerError(`name must be 1-${MAX_TOKEN_NAME} characters`);
    }
    out.name = name;
  }
  if (a.size !== undefined) out.size = between(a, 'size', 0.01, 100);
  if (a.scale !== undefined) out.scale = between(a, 'scale', 0.01, 100);
  if (a.viewDistance !== undefined) out.viewDistance = between(a, 'viewDistance', 0, 10000);
  if (a.baseColor !== undefined) {
    if (a.baseColor === null) throw new HandlerError('baseColor must be a colour');
    out.baseColor = color(a, 'baseColor');
  }
  if (a.textureRepeat !== undefined) out.textureRepeat = pair(a, 'textureRepeat', 0, 100);
  if (a.textureOffset !== undefined) out.textureOffset = pair(a, 'textureOffset', -100, 100);
  if (a.modelOffset !== undefined) out.modelOffset = pair(a, 'modelOffset', -100, 100);
  return out;
}

const handlers: { [name: string]: Handler } = {
  // ---- tokens ----
  addToken(ctx) {
    requireHost(ctx);
    const a = requireObject(ctx.args);
    const modelId = idString(a, 'modelId');
    const tempId = optionalEcho(a, 'tempId');
    const position = { x: num(a, 'x'), y: num(a, 'y'), z: num(a, 'z') };
    const id = newId(ctx.room, ctx.room.state.tokens);
    const token = {
      modelId,
      position,
      scale: { x: 1, y: 1, z: 1 },
      owners: [] as string[],
      settings: { hideAvatar: false, disableCamLook: false },
    };
    ctx.room.state.tokens[id] = token;
    // Sent to everyone including the sender: the sender uses tempId to match its placeholder
    // to the real tokenId.
    ctx.markDirty();
    ctx.broadcast({ tokenId: id, tempId, ...token }, { includeSelf: true });
  },
  removeToken(ctx) {
    requireHost(ctx);
    const tokenId = idString(requireObject(ctx.args), 'tokenId');
    find(ctx.room.state.tokens, tokenId, 'token');
    delete ctx.room.state.tokens[tokenId];
    changed(ctx, { tokenId });
  },
  updateTokenPosition(ctx) {
    const a = requireObject(ctx.args);
    const tokenId = idString(a, 'tokenId');
    const token = requireTokenAccess(ctx, tokenId);
    token.position = { x: num(a, 'x'), y: num(a, 'y'), z: num(a, 'z') };
    changed(ctx, { tokenId, ...token.position });
  },
  updateTokenScale(ctx) {
    requireHost(ctx);
    const a = requireObject(ctx.args);
    const tokenId = idString(a, 'tokenId');
    const token = find(ctx.room.state.tokens, tokenId, 'token');
    token.scale = { x: num(a, 'x'), y: num(a, 'y'), z: num(a, 'z') };
    changed(ctx, { tokenId, ...token.scale });
  },
  updateTokenModel(ctx) {
    requireHost(ctx);
    const a = requireObject(ctx.args);
    const tokenId = idString(a, 'tokenId');
    const token = find(ctx.room.state.tokens, tokenId, 'token');
    token.modelId = idString(a, 'modelId');
    changed(ctx, { tokenId, modelId: token.modelId });
  },
  updateTokenSettings(ctx) {
    const a = requireObject(ctx.args);
    const tokenId = idString(a, 'tokenId');
    const token = requireTokenAccess(ctx, tokenId);
    token.settings = {
      hideAvatar: bool(a, 'hideAvatar'),
      disableCamLook: bool(a, 'disableCamLook'),
      iconColor: color(a, 'iconColor'),
    };
    changed(ctx, { tokenId, ...token.settings });
  },
  // Replaces the token's overrides as a whole; none at all puts it back on its picture's settings.
  // The sender hears it back too: its viewer shows a new name only once the server has accepted it.
  updateTokenOverrides(ctx) {
    requireHost(ctx);
    const a = requireObject(ctx.args);
    const tokenId = idString(a, 'tokenId');
    const token = find(ctx.room.state.tokens, tokenId, 'token');
    const overrides = tokenOverrides(requireObject(a.overrides));
    if (overrides.name !== undefined) {
      const refused = ctx.server.checkName(overrides.name);
      if (refused) throw new HandlerError(refused);
    }
    if (Object.keys(overrides).length > 0) token.overrides = overrides;
    else delete token.overrides;
    ctx.markDirty();
    ctx.broadcast({ tokenId, overrides }, { includeSelf: true });
  },
  updateTokenStats(ctx) {
    requireHost(ctx);
    const a = requireObject(ctx.args);
    const tokenId = idString(a, 'tokenId');
    const token = find(ctx.room.state.tokens, tokenId, 'token');
    token.stats = {
      hp: int(a, 'hp', 0, MAX_HP),
      maxHp: int(a, 'maxHp', 0, MAX_HP),
      ac: int(a, 'ac', 0, MAX_AC),
    };
    changed(ctx, { tokenId, ...token.stats });
  },
  assignToken(ctx) {
    requireHost(ctx);
    const a = requireObject(ctx.args);
    const tokenId = idString(a, 'tokenId');
    const userId = str(a, 'userId');
    const token = find(ctx.room.state.tokens, tokenId, 'token');
    // `owned: false` removes the assignment; default is to add it.
    const owned = a.owned === undefined ? true : bool(a, 'owned');
    const without = token.owners.filter((o: string) => o !== userId);
    if (owned && without.length >= MAX_TOKEN_OWNERS) {
      throw new HandlerError('that token has too many owners');
    }
    token.owners = owned ? without.concat(userId) : without;
    changed(ctx, { tokenId, userId, owned, owners: token.owners });
  },

  // ---- room settings ----
  updateDaylight(ctx) {
    requireHost(ctx);
    ctx.room.state.daylight = num(requireObject(ctx.args), 'daylight');
    changed(ctx, { daylight: ctx.room.state.daylight });
  },
  updateMoonlight(ctx) {
    requireHost(ctx);
    ctx.room.state.moonlight = num(requireObject(ctx.args), 'moonlight');
    changed(ctx, { moonlight: ctx.room.state.moonlight });
  },
  // The clock: a whole number of minutes, or null to take the clock away (the room then looks as
  // it did before it had one).
  updateClock(ctx) {
    requireHost(ctx);
    const a = requireObject(ctx.args);
    if (a.clock === null) {
      delete ctx.room.state.clock;
      changed(ctx, { clock: null });
      return;
    }
    ctx.room.state.clock = int(a, 'clock', 0, MAX_CLOCK);
    changed(ctx, { clock: ctx.room.state.clock });
  },
  updateWeather(ctx) {
    requireHost(ctx);
    const weather = str(requireObject(ctx.args), 'weather');
    if (WEATHERS.indexOf(weather) === -1) {
      throw new HandlerError(`weather must be one of ${WEATHERS.join(', ')}`);
    }
    if (weather === 'clear') delete ctx.room.state.weather;
    else ctx.room.state.weather = weather;
    changed(ctx, { weather });
  },
  updateGridSize(ctx) {
    requireHost(ctx);
    const a = requireObject(ctx.args);
    ctx.room.state.grid = { width: int(a, 'width', 1, 1000), height: int(a, 'height', 1, 1000) };
    changed(ctx, { ...ctx.room.state.grid });
  },

  // ---- planes (map images) ----
  addPlane(ctx) {
    requireHost(ctx);
    const a = requireObject(ctx.args);
    const planeUploadId = idString(a, 'planeUploadId');
    const tempId = optionalEcho(a, 'tempId');
    // The image reference is opaque to the server; the hosting app decides what it means.
    const image = a.image === undefined ? '' : str(a, 'image');
    const position = { x: num(a, 'x'), z: num(a, 'z') };
    const id = newId(ctx.room, ctx.room.state.planes);
    const plane = { position, scale: { x: 1, y: 1 }, rotation: 0, image, planeUploadId };
    ctx.room.state.planes[id] = plane;
    ctx.markDirty();
    ctx.broadcast({ planeId: id, tempId, ...plane }, { includeSelf: true });
  },
  removePlane(ctx) {
    requireHost(ctx);
    const planeId = idString(requireObject(ctx.args), 'planeId');
    find(ctx.room.state.planes, planeId, 'plane');
    delete ctx.room.state.planes[planeId];
    changed(ctx, { planeId });
  },
  // Another picture for the same plane: it keeps its id, place, size, turn and layer.
  updatePlaneImage(ctx) {
    requireHost(ctx);
    const a = requireObject(ctx.args);
    const planeId = idString(a, 'planeId');
    const plane = find(ctx.room.state.planes, planeId, 'plane');
    // both checked before either is stored
    const planeUploadId = idString(a, 'planeUploadId');
    const image = a.image === undefined ? '' : str(a, 'image');
    plane.planeUploadId = planeUploadId;
    plane.image = image;
    changed(ctx, { planeId, planeUploadId: plane.planeUploadId, image: plane.image });
  },
  updatePlaneTransform(ctx) {
    requireHost(ctx);
    const a = requireObject(ctx.args);
    const planeId = idString(a, 'planeId');
    const plane = find(ctx.room.state.planes, planeId, 'plane');
    plane.position = { x: num(a, 'x'), z: num(a, 'z') };
    plane.scale = { x: num(a, 'scaleX'), y: num(a, 'scaleY') };
    plane.rotation = num(a, 'rotation');
    changed(ctx, {
      planeId,
      ...plane.position,
      scaleX: plane.scale.x,
      scaleY: plane.scale.y,
      rotation: plane.rotation,
    });
  },

  // ---- doors ----
  addDoor(ctx) {
    requireHost(ctx);
    const a = requireObject(ctx.args);
    const tempId = optionalEcho(a, 'tempId');
    const position = { x: num(a, 'x'), z: num(a, 'z') };
    const id = newId(ctx.room, ctx.room.state.doors);
    const door = { position, rotation: 0, open: false };
    ctx.room.state.doors[id] = door;
    ctx.markDirty();
    ctx.broadcast({ doorId: id, tempId, ...door }, { includeSelf: true });
  },
  removeDoor(ctx) {
    requireHost(ctx);
    const doorId = idString(requireObject(ctx.args), 'doorId');
    find(ctx.room.state.doors, doorId, 'door');
    delete ctx.room.state.doors[doorId];
    changed(ctx, { doorId });
  },
  updateDoorTransform(ctx) {
    requireHost(ctx);
    const a = requireObject(ctx.args);
    const doorId = idString(a, 'doorId');
    const door = find(ctx.room.state.doors, doorId, 'door');
    door.position = { x: num(a, 'x'), z: num(a, 'z') };
    door.rotation = num(a, 'rotation');
    changed(ctx, { doorId, ...door.position, rotation: door.rotation });
  },
  updateDoorState(ctx) {
    requireHost(ctx);
    const a = requireObject(ctx.args);
    const doorId = idString(a, 'doorId');
    const door = find(ctx.room.state.doors, doorId, 'door');
    door.open = bool(a, 'open');
    changed(ctx, { doorId, open: door.open });
  },

  // ---- wall points ----
  addWallPoint(ctx) {
    requireHost(ctx);
    const a = requireObject(ctx.args);
    const tempId = optionalEcho(a, 'tempId');
    // Group ids are chosen by the client so it can start a new wall polyline.
    const wallGroupId = idString(a, 'wallGroupId');
    const position = { x: num(a, 'x'), z: num(a, 'z') };
    const id = newId(ctx.room, ctx.room.state.wallPoints);
    const point = { wallGroupId, position };
    ctx.room.state.wallPoints[id] = point;
    ctx.markDirty();
    ctx.broadcast({ wallPointId: id, tempId, ...point }, { includeSelf: true });
  },
  removeWallPoint(ctx) {
    requireHost(ctx);
    const wallPointId = idString(requireObject(ctx.args), 'wallPointId');
    find(ctx.room.state.wallPoints, wallPointId, 'wall point');
    delete ctx.room.state.wallPoints[wallPointId];
    changed(ctx, { wallPointId });
  },
  updateWallPoint(ctx) {
    requireHost(ctx);
    const a = requireObject(ctx.args);
    const wallPointId = idString(a, 'wallPointId');
    const point = find(ctx.room.state.wallPoints, wallPointId, 'wall point');
    point.position = { x: num(a, 'x'), z: num(a, 'z') };
    changed(ctx, { wallPointId, ...point.position });
  },

  // ---- misc ----
  // Map ping: relayed to the others, never stored. The sender id comes from the connection,
  // not from the client, so nobody can ping "as" someone else.
  ping(ctx) {
    const a = requireObject(ctx.args);
    ctx.broadcast({ x: num(a, 'x'), z: num(a, 'z') });
  },
  assignHost(ctx) {
    requireHost(ctx);
    const userId = str(requireObject(ctx.args), 'userId');
    const target = ctx.room.connectionsOf(userId);
    if (target.length === 0) throw new HandlerError('that user is not in the room');
    ctx.room.hosts.add(userId);
    target.forEach((c: Connection) => {
      c.role = 'host';
    });
    ctx.broadcast({ userId }, { includeSelf: true });
  },
  getState(ctx) {
    if (ctx.kind !== 'request') throw new HandlerError('getState is a request');
    ctx.reply({ state: ctx.room.state });
  },
};

// Events that mutate nothing may be sent as either kind of message; everything else is `update`
// except the request-only names below.
const REQUEST_ONLY = ['getState'];

export function builtInHandlers(): { [name: string]: Handler } {
  const result: { [name: string]: Handler } = {};
  Object.keys(handlers).forEach((name) => {
    const run = handlers[name];
    result[name] = (ctx) => {
      const isRequestOnly = REQUEST_ONLY.indexOf(name) !== -1;
      if (isRequestOnly !== (ctx.kind === 'request')) {
        throw new HandlerError(
          `${name} must be sent as ${isRequestOnly ? 'a request' : 'an update'}`,
        );
      }
      return run(ctx);
    };
  });
  return result;
}

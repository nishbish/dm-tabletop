// Pure translation between the viewer's internal vocabulary (the original client's event and
// argument names) and protocol v2 of tabletop-server. No sockets, timers or DOM in here, so it
// is easy to test.

export type Args = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Translated {
  name: string;
  args: Args;
}

// Which argument holds the id of the object an outgoing message is about, and which tempId
// argument (if any) creates one. Used to hold back messages for objects the server has not
// numbered yet.
export const ID_KEYS: Record<string, string> = {
  removeToken: 'tokenId',
  updateTokenPosition: 'tokenId',
  updateTokenScale: 'tokenId',
  updateTokenModel: 'tokenId',
  updateTokenSettings: 'tokenId',
  assignToken: 'tokenId',
  removePlane: 'planeId',
  updatePlaneTransform: 'planeId',
  removeDoor: 'doorId',
  updateDoorTransform: 'doorId',
  updateDoorState: 'doorId',
  removeWallPoint: 'wallPointId',
  updateWallPoint: 'wallPointId',
};

// Messages sent continuously while dragging; only the latest one per object matters.
export const COALESCED = [
  'updateTokenPosition',
  'updateTokenScale',
  'updatePlaneTransform',
  'updateDoorTransform',
  'updateWallPoint',
];

// For "add" events: the legacy temp id argument, and the id the server will use for it.
export const TEMP_KEYS: Record<string, { temp: string; real: string }> = {
  addToken: { temp: 'tempTokenId', real: 'tokenId' },
  addPlane: { temp: 'tempPlaneId', real: 'planeId' },
  addDoor: { temp: 'tempDoorId', real: 'doorId' },
  addWallPoint: { temp: 'tempWallPointId', real: 'wallPointId' },
};

const str = (v: unknown) => String(v);

// Viewer -> server. Returns null for events that have no v2 equivalent and must not be sent.
export function toServer(name: string, a: Args): Translated | null {
  switch (name) {
    case 'addToken':
      return {
        name,
        args: { modelId: str(a.modelId), x: a.x, y: a.y, z: a.z, tempId: str(a.tempTokenId) },
      };
    case 'addPlane':
      return {
        name,
        args: {
          planeUploadId: str(a.planeUploadId),
          x: a.x,
          z: a.z,
          image: a.image === undefined ? undefined : str(a.image),
          tempId: str(a.tempPlaneId),
        },
      };
    case 'addDoor':
      return { name, args: { x: a.x, z: a.z, tempId: str(a.tempDoorId) } };
    case 'addWallPoint':
      return {
        name,
        args: {
          wallGroupId: str(a.wallPointGroupId),
          x: a.x,
          z: a.z,
          tempId: str(a.tempWallPointId),
        },
      };
    case 'removeToken':
    case 'updateTokenPosition':
    case 'updateTokenScale':
      return { name, args: { ...a, tokenId: str(a.tokenId) } };
    case 'updateTokenModel':
      return { name, args: { tokenId: str(a.tokenId), modelId: str(a.modelId) } };
    case 'updateTokenSettings':
      return {
        name,
        args: {
          tokenId: str(a.tokenId),
          hideAvatar: !!a.hideAvatar,
          disableCamLook: !!a.disableCamLook,
        },
      };
    case 'assignToken':
      return {
        name,
        args: {
          tokenId: str(a.tokenId),
          userId: str(a.customer_id),
          owned: a.owned === undefined ? true : !!a.owned,
        },
      };
    case 'assignDM':
      return { name: 'assignHost', args: { userId: str(a.customer_id) } };
    case 'removePlane':
      return { name, args: { planeId: str(a.planeId) } };
    case 'updatePlaneTransform':
      return {
        name,
        args: {
          planeId: str(a.planeId),
          x: a.posX,
          z: a.posZ,
          scaleX: a.scaleX,
          scaleY: a.scaleY,
          rotation: a.rotZ,
        },
      };
    case 'removeDoor':
      return { name, args: { doorId: str(a.doorId) } };
    case 'updateDoorTransform':
      return { name, args: { doorId: str(a.doorId), x: a.x, z: a.z, rotation: a.rotation } };
    case 'updateDoorState':
      return { name, args: { doorId: str(a.doorId), open: !!a.open } };
    case 'removeWallPoint':
      return { name, args: { wallPointId: str(a.wallPointId) } };
    case 'updateWallPoint':
      return { name, args: { wallPointId: str(a.wallPointId), x: a.x, z: a.z } };
    case 'ping':
      return { name, args: { x: a.x, z: a.z } };
    case 'saveCamera':
      return null; // the original server ignored it too
    default:
      // updateDaylight, updateMoonlight, updateGridSize and host-app events pass through.
      return { name, args: a };
  }
}

const bit = (v: unknown) => (v ? 1 : 0);

// Server update -> viewer. `from` is the sender's user id. A broadcast can become several viewer
// events (none for something the viewer has no use for).
export function fromServerUpdate(name: string, a: Args, from?: string): Translated[] {
  switch (name) {
    case 'addToken':
      return [
        {
          name,
          args: {
            tokenId: str(a.tokenId),
            tempTokenId: a.tempId,
            modelId: str(a.modelId),
            x: a.position.x,
            y: a.position.y,
            z: a.position.z,
            scale: a.scale,
            owners: a.owners,
            settings: a.settings,
          },
        },
      ];
    case 'addPlane':
      return [
        {
          name,
          args: {
            planeId: str(a.planeId),
            tempPlaneId: a.tempId,
            planeUploadId: str(a.planeUploadId),
            image: a.image,
            x: a.position.x,
            z: a.position.z,
          },
        },
      ];
    case 'updatePlaneTransform':
      return [
        {
          name,
          args: {
            planeId: str(a.planeId),
            posX: a.x,
            posZ: a.z,
            scaleX: a.scaleX,
            scaleY: a.scaleY,
            rotZ: a.rotation,
          },
        },
      ];
    case 'addDoor':
      return [
        {
          name,
          args: {
            doorId: str(a.doorId),
            tempDoorId: a.tempId,
            x: a.position.x,
            z: a.position.z,
            rotation: a.rotation,
            open: bit(a.open),
          },
        },
      ];
    case 'updateDoorState':
      return [{ name, args: { doorId: str(a.doorId), open: bit(a.open) } }];
    case 'addWallPoint':
      return [
        {
          name,
          args: {
            wallPointId: str(a.wallPointId),
            tempWallPointId: a.tempId,
            wallPointGroupId: str(a.wallGroupId),
            x: a.position.x,
            z: a.position.z,
          },
        },
      ];
    case 'updateTokenSettings':
      return [
        {
          name,
          args: {
            tokenId: str(a.tokenId),
            hideAvatar: bit(a.hideAvatar),
            disableCamLook: bit(a.disableCamLook),
          },
        },
      ];
    case 'assignToken':
      return [
        { name, args: { tokenId: str(a.tokenId), customer_id: str(a.userId), owners: a.owners } },
      ];
    case 'assignHost':
      return [{ name: 'updateDM', args: { customer_id: str(a.userId) } }];
    case 'ping':
      return [{ name, args: { x: a.x, z: a.z, customer_id: str(from) } }];
    default:
      // removeToken, updateTokenPosition/Scale/Model, removePlane, removeDoor, door transform,
      // wall point removal/update, daylight, moonlight, grid size and host-app events.
      return [{ name, args: a }];
  }
}

export interface Member {
  userId: string;
  name: string;
  role: string;
}

// The server's full state -> the "room" object the viewer builds its scene from.
// `models` are the model descriptions already resolved for the tokens in the state.
export function stateToRoom(
  state: Args,
  self: { userId: string; role: string; name: string },
  members: Member[],
  models: Args[],
): Args {
  const clients: Args = {};
  const addClient = (m: { userId: string; name: string }) => {
    clients[m.userId] = { name: m.name, live: true, connections: [] };
  };
  members.forEach(addClient);
  if (!clients[self.userId]) addClient({ userId: self.userId, name: self.name });

  const host = members.find((m) => m.role === 'host');
  return {
    name: state.name,
    // The viewer asks "is the host me?": the join answer says so directly.
    dm: self.role === 'host' ? self.userId : host ? host.userId : '',
    daylight: state.daylight,
    moonlight: state.moonlight,
    grid: state.grid,
    clients,
    tokens: state.tokens || {},
    planes: state.planes || {},
    doors: state.doors || {},
    wallPoints: state.wallPoints || {},
    models,
  };
}

// Arguments of a host-app reply are passed through untouched; documented in the README.
export function fromServerResponse(name: string, a: Args): Translated {
  return { name, args: a };
}

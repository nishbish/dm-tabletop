# @dm-tabletop/tabletop-server

The Node websocket server for the 3D tabletop. It keeps each room's world state (tokens, map
images, doors, walls, lighting) in memory, sends the full state to everyone who joins, broadcasts
small updates as things change, and saves rooms through a small storage interface.
Authentication is a pluggable hook; by default anyone can join, which suits local and self-hosted use.

It runs as a single process. TLS is the job of your reverse proxy: the server speaks plain http/ws.

## Quick start

```
npm install
npx tsx packages/tabletop-server/src/cli.ts     # or: npm run start -w @dm-tabletop/tabletop-server
curl localhost:3000/health
```

Or from code:

```ts
import { createTabletopServer, FileStorage } from '@dm-tabletop/tabletop-server';

const server = createTabletopServer({ storage: new FileStorage('./data'), port: 3000 });
await server.start();
// later: await server.stop();   // saves everything, closes sockets with code 1001
```

Requires Node 22.5+ (the SQLite storage uses the built-in `node:sqlite`).

## Building and using it from another repository

The package is TypeScript; `npm run build -w @dm-tabletop/tabletop-server` compiles it to `packages/tabletop-server/dist`
(CommonJS plus `.d.ts` files; tests are not included). `dist` is git-ignored, and only `dist` is published (`files`).

From a sibling checkout, use a local path dependency and build it first:

```
# in the other repo's package.json:  "@dm-tabletop/tabletop-server": "file:../public-repo/packages/tabletop-server"
(cd ../public-repo && npm install && npm run build -w @dm-tabletop/tabletop-server)
npm install
```

```ts
import { createTabletopServer, PostgresStorage } from '@dm-tabletop/tabletop-server';
```

A `file:` dependency is symlinked, so rebuild after changing the package. It brings its own `ws` and `pg`
(install the public repo's dependencies once). The CLI is available as `tabletop-server` (`node dist/cli.js`).
Requires Node 22.5+.

## Environment variables (CLI)

| Variable           | Default  | Meaning                                                            |
| ------------------ | -------- | ------------------------------------------------------------------ |
| `PORT`             | `3000`   | Port to listen on                                                  |
| `STORAGE`          | `file`   | `file`, `sqlite`, `postgres` or `memory`                           |
| `DATA_DIR`         | `./data` | Directory for `file` (JSON per room) and `sqlite` (`rooms.sqlite`) |
| `DATABASE_URL`     |          | Postgres connection string (required for `postgres`)               |
| `SAVE_DEBOUNCE_MS` | `3000`   | Wait this long after the last change before saving a room          |
| `LOG_LEVEL`        | `info`   | `debug`, `info`, `warn`, `error`, `silent`                         |

Logs are JSON lines; tokens and message payloads are never logged. SIGTERM/SIGINT flush all rooms,
close connections and exit 0 (hard exit after 10 s).

## Protocol (v2)

All messages are JSON text. Binary frames are rejected. Messages over 64 KB close the connection (1009).
Each connection may send at most 200 messages per second; extra ones are dropped with an error.

### Connecting

1. Open a websocket to any path.
2. Send `{ "type": "join", "token": "...", "roomId": "..." }` within 5 seconds (otherwise the socket is closed with 4408).
   Send nothing else until you receive `joined`.
3. The server calls `authenticate`. On failure it sends `{ "type": "error", "message": "unauthorized" }` and closes with **4401**.
4. On success: `{ "type": "joined", "userId", "role", "state", "members": [{userId, name, role}] }`.
   `state` is the **full** room state. A reconnecting client just joins again and gets the full state again.

Other close codes: 4400 (bad first message or invalid room id), 4408 (join timeout), 1001 (server shutting down), 1009 (message too big).

### Messages after joining

Client to server:

- `{ "type": "update", "name": "<event>", "args": { ... } }` changes state.
- `{ "type": "request", "name": "<event>", "args": { ... }, "requestId": "<optional>" }` asks for a reply to the sender only.

Server to client:

- `{ "type": "update", "name": "<event>", "args": { ... }, "from": "<userId>" }`: a change made by another member (and, for the "+self" events, also sent back to the sender). Updates are broadcast immediately; clients can throttle what they send.
- `{ "type": "response", "name": "<event>", "args": { ... }, "requestId" }`: reply to a request.
- `{ "type": "presence", "event": "connected" | "disconnected", "userId", "name" }`: sent to the others when a user's first connection joins / last connection leaves.
- `{ "type": "error", "message", "name"?, "requestId"? }`: the message was rejected; the connection stays open.

String arguments are limited to 256 characters, numbers must be finite. Ids (`tokenId` etc.) are strings assigned by the server and are unique within a room. Unknown events, bad arguments and permission failures produce an `error` and change nothing.

### Events

"Host" means the room's host; "owner" means the token lists you in `owners`. "+self" means the update is also sent to the sender (it carries the server-assigned id and echoes your `tempId`).

| Event                  | Who           | Args                                                        | Broadcast args (to others)                                         |
| ---------------------- | ------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `addToken` (+self)     | host          | `modelId, x, y, z, tempId?`                                 | `tokenId, tempId, modelId, position, scale, owners, settings`      |
| `removeToken`          | host          | `tokenId`                                                   | `tokenId`                                                          |
| `updateTokenPosition`  | host or owner | `tokenId, x, y, z`                                          | same                                                               |
| `updateTokenScale`     | host          | `tokenId, x, y, z`                                          | same                                                               |
| `updateTokenModel`     | host          | `tokenId, modelId`                                          | same                                                               |
| `updateTokenSettings`  | host or owner | `tokenId, hideAvatar, disableCamLook` (booleans or 0/1)     | same                                                               |
| `assignToken`          | host          | `tokenId, userId, owned?` (default `true`; `false` removes) | `tokenId, userId, owned, owners`                                   |
| `updateDaylight`       | host          | `daylight`                                                  | same                                                               |
| `updateMoonlight`      | host          | `moonlight`                                                 | same                                                               |
| `updateGridSize`       | host          | `width, height` (integers 1-1000)                           | same                                                               |
| `addPlane` (+self)     | host          | `planeUploadId, x, z, image?, tempId?`                      | `planeId, tempId, position, scale, rotation, image, planeUploadId` |
| `removePlane`          | host          | `planeId`                                                   | `planeId`                                                          |
| `updatePlaneTransform` | host          | `planeId, x, z, scaleX, scaleY, rotation`                   | same                                                               |
| `addDoor` (+self)      | host          | `x, z, tempId?`                                             | `doorId, tempId, position, rotation, open`                         |
| `removeDoor`           | host          | `doorId`                                                    | `doorId`                                                           |
| `updateDoorTransform`  | host          | `doorId, x, z, rotation`                                    | same                                                               |
| `updateDoorState`      | host          | `doorId, open` (boolean or 0/1)                             | same                                                               |
| `addWallPoint` (+self) | host          | `wallGroupId, x, z, tempId?`                                | `wallPointId, tempId, wallGroupId, position`                       |
| `removeWallPoint`      | host          | `wallPointId`                                               | `wallPointId`                                                      |
| `updateWallPoint`      | host          | `wallPointId, x, z`                                         | same                                                               |
| `ping`                 | everyone      | `x, z`                                                      | `x, z` (the sender is in `from`; never saved)                      |
| `assignHost` (+self)   | host          | `userId` (must be in the room)                              | `userId`                                                           |
| `getState` (request)   | everyone      | none                                                        | reply `args: { state }`                                            |

Permissions are enforced on the server: a player can only move or change settings of tokens that list them in `owners`, and can ping; everything else needs the host role. Rooms can hold at most 5000 objects of each kind.

### Legacy to v2 event mapping

The event names mirror the original tabletop client's names, so existing client code keeps its vocabulary.
The differences: `assignDM` became `assignHost`; messages are now `{type, name, args}` instead of `{update|request: name, arguments}`;
ids are strings; `updateTokenSettings` is now broadcast; the join handshake is `join` / `joined`; and the
server, not the client, is the source of truth for who sent a message (`from`).

| Original event                                                                   | v2                     |
| -------------------------------------------------------------------------------- | ---------------------- |
| `join` / `userJoined`                                                            | `join` / `joined`      |
| `clientConnected` / `clientDisconnected`                                         | `presence`             |
| `addToken` ... `updateGridSize`, planes, doors, wall points, `ping`              | same names (see table) |
| `assignDM` / `updateDM`                                                          | `assignHost`           |
| `editModel`, `getModel(s)`, `getPlaneImages`, `deleteModel`, `deletePlaneUpload` | extension points       |
| `getRooms`, `addRoom`, `deleteRoom`, `refreshInviteCode`, `focusCamera`          | extension points       |

## The state

`RoomState` (see `src/types.ts`) has `version: 1`, `name`, `grid`, `daylight`, `moonlight`, `nextId`, and the maps
`tokens`, `planes`, `doors`, `wallPoints`. Saved rooms pass through `migrate(state)` (`src/state.ts`) when loaded, so
future versions can upgrade old saves. Unknown newer versions are refused rather than guessed at.

## Authentication hook

```ts
type AuthenticateFn = (
  token: string,
  request: http.IncomingMessage,
  join: { roomId?: string },
) => AuthResult | null | Promise<AuthResult | null>;

interface AuthResult {
  userId: string;
  roomId: string;
  role?: 'host' | 'player';
  name?: string;
}
```

Return `null` to reject (the client gets `unauthorized` and close code 4401). A hook that throws also rejects.
`roomId` must match `[A-Za-z0-9_-]{1,128}`. A user promoted with `assignHost` stays host while the room stays loaded.

**Default hook (self-hosting):** accepts any token. `userId` is the token (or a random id if the token is empty),
`roomId` comes from the join message (`default` if missing), and the role is `host` for the first user to join
an empty room and `player` for everybody else. Anyone who can reach the server can join any room, so do not
expose it to the internet without your own hook.

Example hook verifying a JWT signed with a shared secret (example only; `jsonwebtoken` is not a dependency of this package):

```ts
import jwt from 'jsonwebtoken';

const secret = process.env.TABLETOP_JWT_SECRET;

const server = createTabletopServer({
  storage,
  authenticate(token) {
    try {
      const claims = jwt.verify(token, secret, { algorithms: ['HS256'] });
      return {
        userId: String(claims.sub),
        roomId: String(claims.room),
        role: claims.role === 'host' ? 'host' : 'player',
        name: claims.name,
      };
    } catch {
      return null;
    }
  },
});
```

## Storage

```ts
interface RoomStorage {
  loadRoom(id: string): Promise<RoomState | null>;
  saveRoom(id: string, state: RoomState): Promise<void>;
}
```

| Class                   | Notes                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `MemoryStorage`         | tests and throwaway servers                                                                           |
| `FileStorage(dir)`      | one `<roomId>.json` per room; written to a temp file then renamed, so a crash can't leave a torn file |
| `SqliteStorage(file)`   | table `rooms(id TEXT PRIMARY KEY, version INTEGER, state TEXT, updated_at TEXT)`, via `node:sqlite`   |
| `PostgresStorage(pool)` | same table with `state JSONB`, using a `pg` `Pool` you create; creates the table if missing           |

All implementations reject room ids that don't match `[A-Za-z0-9_-]{1,128}`, so an id can never point outside the data directory.
The Postgres tests run only when `TEST_POSTGRES_URL` is set.

## Extension points

Pass `handlers` to add events the core does not know (asset libraries, room lists, invite codes, camera focus, ...).
A handler can be used with either `update` or `request` messages (`ctx.kind` tells which) and may be async:

```ts
import { createTabletopServer, HandlerError } from '@dm-tabletop/tabletop-server';

createTabletopServer({
  storage,
  handlers: {
    getRooms(ctx) {
      if (ctx.user.role !== 'host') throw new HandlerError('only the host can do that');
      ctx.reply({ rooms: myRoomList() }); // to the sender only
    },
    focusCamera(ctx) {
      ctx.broadcast(ctx.args, { includeSelf: false }); // {type:"update", name:"focusCamera", args, from}
    },
  },
});
```

The context gives you `kind`, `name`, `args` (untrusted: validate them), `user` (`userId`, `name`, `role`), `room` (`room.state`),
`reply(args)`, `broadcast(args, { includeSelf?, name? })` and `markDirty()` (call it after changing `room.state` so the room is saved).
Throw `HandlerError` to send a message back to the sender as an error; any other exception is logged and reported as `internal error`.
A handler with the same name as a built-in replaces it. Handlers from one connection may run concurrently if they are async.

## Persistence guarantees

- Rooms live in memory while at least one connection is in them; they are loaded from storage on first join.
- Every change marks the room dirty and restarts a timer (`saveDebounceMs`, default 3 s); a burst of moves is one write.
  Continuous changes cannot postpone a save forever: at most `maxSaveDelayMs` (default 10x the debounce) after the first unsaved change it is saved anyway.
- A room is also saved when its last connection leaves (and then unloaded), and `stop()` / SIGTERM saves every dirty room
  **before** closing sockets.
- A failed save is logged and does not crash anything; the room stays dirty and is retried on the next change, by a retry timer (every 5 s or the debounce, whichever is longer), and on `stop()`. A dirty room is never unloaded.
- What can still be lost: changes made in the last `saveDebounceMs` if the process is killed without a signal (crash, `kill -9`, power loss).
- `ping` and presence are never persisted.

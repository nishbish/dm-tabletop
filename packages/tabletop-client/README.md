# @dm-tabletop/tabletop-client

The Three.js viewer for the 3D tabletop. It joins a room on a
[`tabletop-server`](../tabletop-server/README.md), builds the scene (map images, tokens, doors, walls,
fog of war) from the full state it receives, and sends small updates when the host or a player changes
something.

Everything the viewer needs to know about its surroundings (server address, who you are, where images
live, whether uploads exist) is an option. Nothing is hard-coded, and nothing is sent anywhere but your
server.

## Try it

```
npm install
npm run demo          # from the repo root
```

This starts the real server (in-memory storage, open login, port 3000) and the viewer's test page
(port 5173). Open the two printed links in two browser tabs: the first one in is the host, the second a
player. Right-click the floor, choose "Add Token", drag it: the move shows up in the other tab.

Other scripts (all run from the repo root with `-w @dm-tabletop/tabletop-client`, or inside the package):

| Script          | What it does                                                                      |
| --------------- | --------------------------------------------------------------------------------- |
| `npm run dev`   | Vite dev server for `dev/index.html` on http://127.0.0.1:5173 (needs a server)    |
| `npm run build` | Library build into `dist/` plus the test page into `dist/dev/` (both git-ignored) |
| `npm run demo`  | Server + test page together (see above)                                           |
| `npm test`      | Unit tests (vitest): the transport adapter                                        |
| `npm run e2e`   | Builds, then runs the Playwright test in `e2e/` (see "End-to-end test")           |

The test page takes query parameters: `?server=ws://localhost:3000&room=table1&token=alice`, or `?demo=1`
for the offline demo (no server at all).

## Using it

```js
import { createTabletop } from '@dm-tabletop/tabletop-client';
import '@dm-tabletop/tabletop-client/style.css';

const tabletop = createTabletop(document.getElementById('app'), {
  serverUrl: 'wss://tabletop.example.org',
  token: 'whatever your server's authenticate hook understands',
  roomId: 'table1',
});

tabletop.destroy(); // removes everything again
```

The viewer fills its container, so give the container a size. Its stylesheet is global (class and id
names are not prefixed), so it is best used on a page of its own or in an iframe.

### Options

| Option         | Default                                                        | Meaning                                                                                                                                                            |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `serverUrl`    | `ws(s)://<this host>:3000`                                     | WebSocket address of the server                                                                                                                                    |
| `token`        | random, kept per browser tab                                   | Sent in the join message. The server's authenticate hook decides what it means. The default server accepts any token and uses it as the user id                    |
| `roomId`       | `default`                                                      | Room to join                                                                                                                                                       |
| `demo`         | `false`                                                        | Offline demo room, no server needed. Changes are not saved                                                                                                         |
| `assetBaseUrl` | `''`                                                           | Prefix for files the viewer loads itself: default image locations and skybox faces                                                                                 |
| `imageUrl`     | `<assetBaseUrl>/images/models/<src>` or `/images/planes/<src>` | `({kind: 'model' \| 'plane', src, size, quality}) => url`. Absolute URLs and `data:` URIs in `src` are used as they are. Use this to point at your own image proxy |
| `avatarUrl`    | a small drawn circle with the initial                          | `({userId, name}) => url` for the player list                                                                                                                      |
| `uploadModel`  | none: upload UI hidden                                         | `async (formData) => result` called when the host uploads a token image (see below)                                                                                |
| `uploadPlane`  | none: upload UI hidden                                         | same for map images                                                                                                                                                |
| `inviteLink`   | none: invite button hidden                                     | `(code) => url`; the host app provides the code (see "Host-app extension points")                                                                                  |
| `trackerUrl`   | none: tracker pane hidden                                      | URL of an initiative tracker to embed in an iframe                                                                                                                 |
| `resolveModel` | built-in cylinder tokens                                       | `async (modelId) => {id, name, src, baseColor, ...} \| null`, see "Tokens and models"                                                                              |
| `skybox`       | plain gradient sky                                             | `{day: {path, extension}, night: {...}}`: six face images `<assetBaseUrl>/<path>_<ft\|bk\|up\|dn\|rt\|lf><extension>` (`.tga` works too)                           |
| `debug`        | `false`                                                        | Exposes `tabletop.debug.map`, the internal state object                                                                                                            |

`createTabletop` returns `{ destroy(), getSceneStats(), getTokenPosition(id), getTokenScreenPosition(id), debug }`.
The last three exist mainly for tests.

Upload hooks receive a `FormData` (`file`, `name`, and for tokens the form fields) and return one of:
`{ error: 'message' }`, `{ limit: { title, description } }` (shows a notice), or for tokens
`{ model: { id, name, src, textureRepeatX, ..., baseColor } }`. Upload and storage are entirely the host
app's business; the plain server has none.

### Tokens and models

The server stores only a `modelId` per token. What a token looks like (picture, size, colour) is resolved
by the viewer: `options.resolveModel(modelId)` may return `{ id, name, src, size, scale, baseColor, ... }`
(missing fields get defaults). If it is absent, returns nothing or throws, the token is drawn as a
**coloured cylinder**, the colour derived from the id. A plain self-hosted server therefore works with zero
setup: "Add Token" offers eight built-in coloured tokens (`default-red`, `default-blue`, ...).
The same applies to map images: without an image library you can add one by URL.

### Host-app extension points

These events are not part of the core server. A hosting app can implement them as `handlers` in
`createTabletopServer` (see the server README). The viewer degrades gracefully when the server answers
"unknown event": it shows a short non-blocking message and never crashes. After the first refusal it stops
asking.

| Event                                         | Direction | What the viewer expects                                                                                                                                            | Without it                                                                                     |
| --------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `getModels` (request)                         | to server | args `{parentId, folderId, limit, offset}`; reply `{folders: [{folderId, parentId, name}], models: [{modelId, name, src, ownerId}], folderId, parentId, showNext}` | Built-in coloured tokens are offered locally                                                   |
| `getPlaneImages` (request)                    | to server | reply `{folders: [...], planes: [{planeUploadId, name, src, ownerId}], folderId, parentId, showNext}`                                                              | Empty list with "add image by URL"                                                             |
| `getModel` (request)                          | -         | answered inside the viewer by `resolveModel`; never sent                                                                                                           | -                                                                                              |
| `deleteModel`, `deletePlaneUpload` (request)  | to server | args `{modelId}` / `{planeUploadId}`; reply `{tokens: [ids]}` / `{planes: [ids]}` of objects to remove                                                             | Message "not available"; the delete button appears only for entries whose `ownerId` is not `0` |
| `editModel` (update)                          | both      | args `{modelId, ...}`; only reachable when `uploadModel` exists                                                                                                    | Message "not available"                                                                        |
| `getRooms`, `addRoom`, `deleteRoom` (request) | to server | reply `{rooms: [{room_id, name}]}`. Choosing a room joins it over the same connection                                                                              | Message "not available"                                                                        |
| `refreshInviteCode` (request)                 | to server | reply `{inviteCode}`; with `options.inviteLink` the link is copied to the clipboard                                                                                | Invite button hidden (no `inviteLink`) or message                                              |
| `focusCamera` (update)                        | both      | args `{xpos, ypos, zpos, xtarget, ytarget, ztarget, roomId?}`, broadcast by the server                                                                             | Message "not available"                                                                        |

`saveCamera` (sent by the original client, ignored by its server) is no longer sent.

## Reconnecting and sending

- If the connection drops, the viewer retries by itself: after 1 s, 2 s, 4 s, 8 s, then every 15 s, with a
  little random jitter, and shows a "Reconnecting" banner. A refused login (close code 4401/4400) is not
  retried.
- After every (re)join the server sends the full state. The viewer **removes everything built from the
  previous state first**, so tokens, planes, doors and walls are never doubled. The camera and settings stay.
- Continuous changes while dragging (token moves, map image and door transforms, wall points) are sent at
  most about 20 times per second per object, and always end with the final position. Add events wait for
  the server's id: moves made before the id arrives are sent afterwards.
- Changes made while disconnected are not queued: the state you get on reconnect is the server's.

## How the code is organised

| File                                                           | What                                                                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/index.js`                                                 | Public entry: `createTabletop`                                                                             |
| `src/tabletop.js`                                              | The ported viewer (scene, controls, panes, menus). One big function, as in the original                    |
| `src/connection.ts`, `src/protocol.ts`                         | The transport adapter: v2 wire messages to and from the viewer's vocabulary; reconnect, throttle, ordering |
| `src/config.ts`, `src/models.ts`, `src/demo.ts`                | Options and URL builders, token models and fallbacks, the offline demo room                                |
| `src/ui.js`, `src/skybox.js`                                   | Toasts and banner, the sky                                                                                 |
| `src/TranslateControls.js` and the other controls              | The original drag, rotate, scale and hover helpers                                                         |
| `src/context-menu.js`, `src/style.css`, `src/context-menu.css` | The original menu and styles                                                                               |

### Legacy code

`tabletop.js` and the control files are the original client ported with as few changes as possible.
Every deliberate change to its logic is marked with a `NOTE(port)` comment saying why. The main ones:
three.js was updated (renamed geometry classes, legacy colours and light levels kept), ids are opaque
strings, the room is rebuilt from a full state on every join, alerts became toasts, hard-coded URLs became
options, the room switch no longer reloads the page, and "Make DM" adds a host without demoting the sender
(that is what `assignHost` does).

To keep it comparable with the original, these files are excluded from Prettier (`.prettierignore`) and a
package-local `eslint.config.mjs` turns off three rules for them only (`no-unused-vars`, `no-this-alias`,
`no-unused-expressions`). All other rules, and all new code, are linted and formatted normally.

## End-to-end test

`npm run e2e` builds the test page, starts it with `vite preview`, and runs `e2e/tabletop.spec.ts` in Chromium:
the test starts the real server (file storage in a temp directory), opens two browser contexts that join one
room, adds a token as host through the menu, drags it, checks that the other player sees it at the new
position, then stops and restarts the server twice (gracefully) and checks that both clients reconnect, the
token is still there and nothing is duplicated.

Set up once with `npx playwright install chromium` (set `E2E_CHANNEL=chrome` to use an installed Chrome
instead). Headless Chromium has no GPU, so the test launches it with
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`, which selects
Chromium's bundled software WebGL.

## Assets

No images, textures, skyboxes, models or fonts ship with this package: the sky is a drawn gradient, walls are
generated geometry, tokens without a picture are cylinders, the font is the system font stack. The only
bundled file is the Material Icons font for the button icons (Apache-2.0). See `ASSETS.md` in the repo root.

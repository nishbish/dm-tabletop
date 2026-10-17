# dm-tabletop

Open-source tabletop tools for running tabletop RPG sessions: an initiative tracker and a shared
3D tabletop with a websocket server. It is self-hostable, and authentication is a pluggable hook:
by default anyone can join, and you can supply your own implementation to verify users.

## Layout

```
packages/
  initiative-tracker/   standalone turn-order tracker
  tabletop-client/      Three.js viewer (Vite build, talks protocol v2 to the server)
  tabletop-server/      Node websocket server: rooms, world state, persistence
```

The repo uses npm workspaces with a shared `tsconfig.base.json`.

## Quick start

Requires Node.js 20 or newer.

```
npm install
npm test
```

Other checks: `npm run typecheck`, `npm run lint`, `npm run format:check`.

Try the tabletop locally: `npm run demo` starts the server and the viewer; open the printed link in two
browser tabs. The end-to-end browser test is `npm run e2e` (needs `npx playwright install chromium` once).
See [packages/tabletop-client](packages/tabletop-client/README.md).

## Licence

AGPL-3.0, see [LICENSE](LICENSE). Contributions are welcome under the terms in
[CONTRIBUTING.md](CONTRIBUTING.md).

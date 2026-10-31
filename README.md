# dm-tabletop

Open-source tabletop tools for running tabletop RPG sessions: an initiative tracker and a shared
3D tabletop with a websocket server. It is self-hostable, and authentication is a pluggable hook:
by default anyone can join, and you can supply your own implementation to verify users.

If you would rather not run your own, the hosted version is [DM Tools](https://dm.tools), which has a free plan
and is built on these packages.

## Layout

```
packages/
  initiative-tracker/   standalone turn-order tracker (dependency-free library + demo page)
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
browser tabs. The end-to-end browser tests (both packages) run with `npm run e2e` (needs `npx playwright install chromium` once).
See [packages/tabletop-client](packages/tabletop-client/README.md).

Try the initiative tracker: `npm run dev -w @dm-tabletop/initiative-tracker` and open the printed link.
See [packages/initiative-tracker](packages/initiative-tracker/README.md). Its built-in creature list comes from
the D&D 5e SRD 5.1 (CC-BY-4.0); the attribution is in [ASSETS.md](ASSETS.md).

## How this is built

The original DM Tools website, including the first version of the 3D tabletop, was written entirely by hand by
the maintainer. The packages here are a rebuild of that work: the original was recreated and then extended with
heavy use of [Claude Code](https://claude.com/claude-code), Anthropic's AI coding assistant, which wrote most of
the code in this repo. Parts of the viewer are ported from the original hand-written code (see
[packages/tabletop-client](packages/tabletop-client/README.md)).

The maintainer decides what gets built and how it should work, and checks the changes before they are merged.
Commits made with Claude carry a `Co-Authored-By: Claude` line, and [CLAUDE.md](CLAUDE.md) holds the project
instructions it works from.

The maintainer has very little time to write code by hand. Without AI, keeping this project updated and
maintained would not be possible at all.

## Licence

AGPL-3.0, see [LICENSE](LICENSE). Contributions are welcome under the terms in
[CONTRIBUTING.md](CONTRIBUTING.md).

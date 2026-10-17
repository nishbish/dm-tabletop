# CLAUDE.md — public repo (open-source tabletop + initiative tracker)


## What this repo is

Open-source code for two things:

1. **Initiative tracker** — a standalone JS/TS app/library for tracking turn order in tabletop RPG sessions.
2. **3D tabletop** — a Three.js client plus a Node websocket server that keeps shared world state (token positions, map, etc.) per room.

A separate, PRIVATE repo ("platform") handles accounts, Stripe billing and subscription checks, and consumes the packages here. This repo must work on its own for anyone who self-hosts.

## Layout (keep this section up to date)

```
packages/
  initiative-tracker/   standalone tracker, no knowledge of accounts or billing
  tabletop-client/      Three.js viewer (Vite build, talks protocol v2 to the server)
  tabletop-server/      Node websocket server: rooms, world state, persistence
```

npm workspaces at the root. One shared `tsconfig.base.json`.

## HARD RULES (never break these, even if asked in passing)

- Nothing in this repo may mention or depend on Stripe, subscriptions, pricing, customer data, or any private URL/domain.
- Never import from the private platform repo. The dependency only goes one way: platform -> this repo.
- Never commit secrets: API keys, DB passwords, tokens, `.env` files. Config comes from environment variables, and `.env.example` documents every variable with fake values.
- Authentication is a pluggable hook, not a built-in paywall. The server exposes something like `authenticate(token) => { userId, roomId, role } | null`. The default implementation allows anyone (for local/self-hosted use). The hosted platform supplies its own implementation that verifies signed tokens.
- Third-party assets (3D models, textures, maps, fonts, icons) must have a licence that allows redistribution. Record each asset's source and licence in `ASSETS.md`. If a licence is unclear, do not add the asset; ask me.
- No analytics, tracking or phone-home code.

## Architecture notes

- **World state:** the server holds each room's state in memory as a JSON object and sends the full state to every new joiner, then broadcasts small updates (e.g. "token X moved to Y"). Keep the state shape versioned (`version` field) so saved rooms can be migrated.
- **Persistence:** save through a small storage interface (`loadRoom(id)`, `saveRoom(id, state)`), with simple implementations for SQLite/file and MySQL or Postgres. Saves are **debounced** (a few seconds after the last change) and also happen when a room empties and on graceful shutdown (SIGTERM). Do not write to the database on every single update.
- **Reliability:** the server needs a `/health` endpoint, structured logs, and a graceful shutdown handler. It must run fine as a single process.
- **Reconnects:** clients that disconnect and reconnect should get the current full state again.

## Code style

- TypeScript files, `"strict": false`. Exception: the ported viewer code in `packages/tabletop-client` is plain JS kept close to the original (see its README). Run with `tsx` in development. Do not spend effort making types fancy: plain interfaces, no clever generics.
- Keep code simple and readable. Small files, clear names, comments explaining *why*.
- Use `import`/`export` syntax, compiled to CommonJS-compatible output unless there is a good reason otherwise.
- Prefer boring, well-known libraries (`ws` or Socket.IO, `express` or `fastify`). Ask before adding a new dependency.

## Commands

- Install: `npm install`
- Dev: `npx tsx <file>`; tabletop-server: `npm run dev -w @dm-tabletop/tabletop-server` (reads `.env.example` variables from the environment)
- Test: `npm test` (vitest, all workspaces)
- Tabletop demo: `npm run demo` (server + viewer dev page); client build: `npm run build -w @dm-tabletop/tabletop-client`; browser test: `npm run e2e` (Playwright, needs `npx playwright install chromium` once)
- Typecheck: `npm run typecheck`
- Lint: `npm run lint` (eslint, flat config)
- Format: `npm run format` (write) / `npm run format:check` (check only), prettier

## Testing

- Add tests for room behaviour: join, receive full state, move a token, reconnect, debounced save, shutdown save.
- Run the tests before saying a task is done.

## Working with me

- I am short on time and rely on you for most of the implementation. Work in small steps that I can review as separate commits/PRs.
- When unsure whether something belongs in this public repo or the private one, assume it belongs in the private one and ask me.
- Before any release, scan git history and files for secrets (e.g. with gitleaks) and report the result.
- Licence: AGPL-3.0 (`LICENSE`). Outside contributions need the terms in `CONTRIBUTING.md` (contributor grant to the maintainer). Do not change the licence.

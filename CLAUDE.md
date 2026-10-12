# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Self-hosted Magic: The Gathering cube draft simulator for a small group of friends. One host runs the server, imports a CubeCobra cube, and players join in the browser. See README.md for user-facing setup and behavior.

## Commands

npm workspaces monorepo (`shared`, `server`, `client`), Node 20.11+.

```bash
npm install
npm start                          # builds shared → server → client, serves everything on :4000
npm run dev:server                 # tsx watch, port 4000
npm run dev:client                 # Vite on 5173, talks to :4000 via client/.env.development
npm run build:shared               # rebuild shared/dist after changing shared types

npm test --workspace server        # all server tests (node:test via tsx)
# single file / single test (run from server/):
node --import tsx --test src/draftEngine/draftEngine.test.ts
node --import tsx --test --test-name-pattern "enforces capacity" src/session/lobbyManager.test.ts

npm run lint --workspace client    # oxlint (client only; the server has no linter)
npm run build --workspace client   # tsc -b && vite build (typecheck)
npm run import-cards --workspace server  # force a Scryfall card cache refresh
```

`@draft-simulator/shared` resolves to `shared/dist`, so **run `npm run build:shared` before server/client typecheck, tests, or dev** whenever `shared/src` changed or `dist` is missing.

`socketHandlers.integration.test.ts` needs internet (imports a real CubeCobra cube) and a populated `server/data/cards.sqlite3`. All other tests are network-free.

## Architecture

**Single process, one draft at a time.** The server holds exactly one `DraftSession` in memory. There is no per-draft routing or room concept: every socket gets every `lobby:state` broadcast.

**shared/** holds the wire contract. `events.ts` defines the typed `ClientToServerEvents` / `ServerToClientEvents` that both the Socket.IO server and client are parameterized with. Client→server actions use ack callbacks that return `ActionResult` (`{ok:true,...} | {ok:false,error}`). Server handlers catch errors and report them through the callback rather than throwing. `DraftState` in `draft.ts` is the full persisted state. `LobbyStateView` is the public projection.

**Server layering** (`server/src`):
- `draftEngine/`: pure state machine (`submitPick`, round advance, pack rotation by `passDirection`). It mutates `DraftSession` in place. `DraftSession` extends `DraftState` with a server-only `packQueue[round][seat]`. `beginDraftWithPacks` exists so tests can bypass random pack generation.
- `session/lobbyManager.ts`: owns the module-level session state, validates actions, and persists a JSON snapshot (`server/data/draft-session.json`, override with `DRAFT_SNAPSHOT_PATH`) after every mutation. It writes through a temp file, fsyncs, and renames atomically, with Windows lock retries. `persist()` must never throw because the in-memory state is the source of truth. A failed write is retried in the background so broadcasts still go out. A corrupt snapshot is renamed to `.corrupt.<ts>`, not discarded. `createLobbyFromResolvedCube` and `resetForTests` exist for network-free tests.
- `realtime/socketHandlers.ts`: maps socket ↔ playerId (the server, not the client, decides who is picking). It enforces host-only actions and controls **broadcast ordering**. `lobby:state` is public and never contains packs or pools. `draft:myState` and `draft:complete` go privately to one player's socket. When a round advances, packs are sent *before* lobby state so a player never sees a stale pack as pickable. Read the comments in the `draft:pick` handler before reordering emits. Rejoining as an already-connected player evicts the old socket (`identity:evicted`).
- `cardData/` + `db/`: local SQLite (better-sqlite3) cache of Scryfall bulk data. It is auto-downloaded on startup if empty (blocking) or stale (background, `CARD_CACHE_MAX_AGE_DAYS`). Schema migrations are hand-rolled in `getDb()` (check `PRAGMA table_info`, then `ALTER TABLE`).
- `cubeImport/`: fetches CubeCobra's cube JSON and resolves card names against the local DB. Duplicates are preserved and unresolved names are reported.
- `images/`: `/images/:scryfallId` proxies and caches card images to disk so clients never hit Scryfall directly.
- `index.ts`: Express + Socket.IO bootstrap, optional `LOBBY_PASSWORD` socket middleware (rejects with the `"invalid_password"` marker the client checks for), and serves `client/dist` if it is built. A global `unhandledRejection` handler keeps the server alive.

Runtime data (card DB, image cache, snapshot) lives in the gitignored `server/data/`. Delete `draft-session.json` to reset a stuck draft.

**Client** (`client/src`): React 19 + Vite. `socket.ts` is a module-level singleton connection (`VITE_SERVER_URL` in dev, same-origin in prod). `useDraftConnection.ts` holds all server-driven state and the reconnect flow: a stored playerId in localStorage triggers `lobby:reconnect` on every connect. `App.tsx` is a screen state machine keyed on `lobbyState.status` (`empty` → `lobby` → `drafting` → `complete`) and whether this browser is seated. Other client-local persistence: `pileStorage.ts` (deck builder piles) and `lobbyPassword.ts`.

## Conventions

- ESM throughout. Server and shared use `NodeNext` resolution, so relative imports need the `.js` extension even from `.ts` files. The client follows the same style.
- Server tests use `node:test` + `node:assert/strict`, are colocated as `*.test.ts`, and are excluded from the server `tsc` build. Lobby tests call `lobbyManager.resetForTests(tmpPath)` to isolate snapshot state.
- Comments explain *why*, often a past bug such as a stuck draft, a crash, or a stale pack. Keep that style, and keep those guards when refactoring.

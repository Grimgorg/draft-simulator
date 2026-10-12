# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Self-hosted Magic: The Gathering cube draft simulator for a small group of friends. One host runs the server, imports a CubeCobra cube, and players join from a browser. README.md covers user-facing setup, configuration (`PORT`, `LOBBY_PASSWORD`, `CARD_CACHE_MAX_AGE_DAYS`) and draft flow.

## Commands

This is an npm workspaces monorepo (`shared`, `server`, `client`) that needs Node 20.11+. There is no root `test`, `lint` or `typecheck` script; run the workspace scripts below.

**Setup / run**
```bash
npm install
npm start                  # builds shared → server → client, serves everything on :4000
npm run dev:server         # tsx watch on :4000
npm run dev:client         # Vite on :5173, pointed at :4000 by client/.env.development
```

**Test** (server only; the client has no tests)
```bash
npm test --workspace server
# from server/: one file, or one named test
node --import tsx --test src/draftEngine/draftEngine.test.ts
node --import tsx --test --test-name-pattern "enforces capacity" src/session/lobbyManager.test.ts
```
In `socketHandlers.integration.test.ts`, the first three tests need internet access (they import a real CubeCobra cube) and a populated `server/data/cards.sqlite3`. The "round advance" test in that file and every other test run without the network.

**Type-check & lint**
```bash
npm run build:shared                 # emits shared/dist
npm run build --workspace server     # tsc -b (emits server/dist)
npm run typecheck --workspace server # tsc --noEmit over all of server/src, tests included
npm run build --workspace client     # tsc -b && vite build
npm run lint --workspace client      # oxlint; the server has no linter
```
- `@draft-simulator/shared` resolves to `shared/dist`. **Run `npm run build:shared` first** whenever `shared/src` changed or `dist` is missing, or the server and client won't see the change.
- Test files (`*.test.ts`, `testHelpers.ts`) are excluded from the server build, and tsx doesn't type-check, so **only `npm run typecheck --workspace server` checks them** (via `server/tsconfig.typecheck.json`).
- There is no formatter config. Match the existing style: double quotes, semicolons, lines up to about 120 characters.

**Data**
```bash
npm run import-cards --workspace server   # force a Scryfall card-cache refresh
```

## Architecture

The server is a single process that runs **one draft at a time**. It holds a single `DraftSession` in memory, with no rooms or per-draft routing, and every socket receives every `lobby:state` broadcast.

**`shared/`** is the wire contract. `events.ts` types `ClientToServerEvents` and `ServerToClientEvents`, and both ends of Socket.IO are parameterized with them. Client actions use ack callbacks that return `ActionResult` (`{ok:true,...} | {ok:false,error}`). `draft.ts` defines `DraftState`, the full persisted draft, and `lobbyView.ts` defines `LobbyStateView`, its public projection.

**`server/src/`**
- `draftEngine/` is a pure, synchronous state machine: deal, `submitPick`, rotate packs by `passDirection`, advance rounds. It mutates `DraftSession` in place, by design. `DraftSession` adds a server-only `packQueue[round][seat]` to `DraftState`.
- `session/lobbyManager.ts` owns the module-level state, validates actions, and saves a snapshot after every mutation through `session/snapshotStore.ts`. The store knows nothing about the state's shape. It writes to a temp file, fsyncs, then renames into place, with retries for Windows file locks. `saveSnapshot()` never throws, because the in-memory state is the source of truth; a failed write is retried in the background and writes the latest state. A corrupt snapshot is kept as `.corrupt.<ts>`. `lobbyStateView.ts` and `deckExport.ts` build outgoing views from the session.
- `realtime/lobbyPassword.ts` is the optional `LOBBY_PASSWORD` connection middleware, rejecting with the `"invalid_password"` marker the client checks for.
- `realtime/socketHandlers.ts` maps sockets to player ids (the server, not the client, decides who is picking). It enforces host-only actions and controls broadcast order. Rejoining as a player who is already connected evicts the old socket with `identity:evicted`.
- `cardData/` + `db/` hold the SQLite (better-sqlite3) cache of Scryfall bulk data. It downloads automatically on startup: blocking when empty, in the background when stale.
- `cubeImport/` fetches CubeCobra cube JSON and resolves names against the local DB. Duplicate cards are kept, and names it can't find are reported.
- `images/` serves `/images/:scryfallId` as a disk-cached proxy, so clients never call Scryfall.
- `index.ts` is the Express + Socket.IO bootstrap. It installs the lobby password middleware, serves `client/dist` when it has been built, and installs a global `unhandledRejection` backstop.

**`client/src/`** is React 19 + Vite.
- `socket.ts` is a module-level socket singleton.
- `useDraftConnection.ts` holds all server-driven state and the reconnect flow: a stored playerId triggers `lobby:reconnect` on every connect.
- `App.tsx` is a screen state machine keyed on `lobbyState.status` (`empty → lobby → drafting → complete`) and on whether this browser holds a seat.

### Module boundaries
- `shared` has no internal dependencies. `server` and `client` depend on `shared`, and **never on each other**.
- `draftEngine` imports only `shared` and its own `packGenerator`; it does no I/O, persistence or networking.
- Only `lobbyManager` holds session state, calls engine mutators, and saves the snapshot (via `snapshotStore`).
- Only `socketHandlers` emits socket events. `lobby:state` is public and must never carry packs or pools. `draft:myState` and `draft:complete` go only to the owning player's socket.
- Only `useDraftConnection` subscribes to socket events on the client. Components emit through the `socket` singleton and receive state as props.

### Persisted state & contracts (compatibility boundaries)
- **Snapshot**: `server/data/draft-session.json` (override with `DRAFT_SNAPSHOT_PATH`) is the JSON of `LobbyManagerState`, including `DraftSession`. Shape changes affect reloading a draft that was in progress when the server restarted.
- **Card DB**: `server/data/cards.sqlite3`. Schema changes go in `getDb()` (`db/database.ts`) as additive in-place migrations: check `PRAGMA table_info`, then `ALTER TABLE`.
- **Socket events**: a change to `shared/src/events.ts` must land in the server and the client in the same change.
- **Browser storage**: the `localStorage` keys in `pileStorage.ts`, `playerIdentity.ts` and `lobbyPassword.ts` hold saved player state, so renaming a key loses it.
- Runtime data lives in the gitignored `server/data/`. Deleting `draft-session.json` resets a stuck draft.

## Naming & organization
- Modules are camelCase `.ts` files grouped by concern (`draftEngine/`, `session/`, `realtime/`, …). React components are PascalCase `.tsx` files in `client/src/components/`.
- Exports are named; `App.tsx` is the only default export. Component props use an `XxxProps` interface.
- Functions that build outgoing views or keys use the `build*` prefix (`buildLobbyStateView`, `buildDeckExports`, `buildDraftPilesKey`).
- Socket events are named `namespace:action` (`lobby:*`, `draft:*`, `cube:*`, `identity:*`).
- Everything is ESM with `NodeNext` resolution, so relative imports use a `.js` extension even from `.ts` and `.tsx` files.
- Tests use `node:test` and `node:assert/strict`, sit next to the code as `*.test.ts`, and use the existing seams: `testCard`/`testPack` (`draftEngine/testHelpers.ts`), `beginDraftWithPacks` (skips random packs), `createLobbyFromResolvedCube` (skips the network), and `resetForTests(tmpPath)` (isolates snapshot state).

## Writing maintainable code here
- Keep each layer to its job. Rules live in `draftEngine`, state in `lobbyManager`, file persistence in `snapshotStore`, and transport and ordering in `socketHandlers`. `submitPick` returns a `PickOutcome`; branch on it rather than re-deriving round state from `waitingOn`.
- Socket handlers report failures through the `ActionResult` callback. Nothing in a handler, including `disconnect`, may throw: an uncaught error there takes down every player's draft.
- Comments explain *why*, usually a past failure (a stuck draft, a crash, a stale pack). Keep those comments and the guards they describe. Write new ones the same way, and don't add comments that just restate the code.
- Prefer small named functions and the existing helpers (e.g. `ConfirmButton` rather than `window.confirm`, which blocks socket reconnects) over new abstractions or dependencies.

## Refactoring safely
- Handle one concern per change, and keep refactors separate from behavior changes.
- Before restructuring `draftEngine` or `lobbyManager`, make sure tests cover the current behavior. Add tests first, using the seams above.
- Read the comments in the `draft:pick` handler before reordering any emits in `socketHandlers`. Packs must go out before the lobby state that says it's the player's turn.
- Treat the persisted state and contracts above as compatibility boundaries. Change them deliberately, never as a side effect.
- The client has no tests, so split large components (`DeckBuilder.tsx`, `DraftBoard.tsx`) one step at a time, checking each step in the browser.

## Before finishing a change
1. If `shared/` changed, run `npm run build:shared`.
2. Run `npm test --workspace server`. If the network-dependent integration tests can't reach the network, report them as skipped or failed, not as passed.
3. Run `npm run build --workspace server` and `npm run typecheck --workspace server`, then `npm run lint --workspace client` and `npm run build --workspace client`.
4. For UI or realtime changes, run `dev:server` and `dev:client` and try the flow in two browser sessions (host and player).
5. Review `git diff`. Look for unintended behavior changes, removed guard comments, and stray files under `server/data/` or `dist/`.
6. Report anything that was skipped or could not be verified.

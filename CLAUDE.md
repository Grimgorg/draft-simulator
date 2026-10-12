## Project

Self-hosted Magic: The Gathering cube draft simulator for a small group of friends: one host runs the server and imports a CubeCobra cube, and players join from a browser. README.md covers user-facing setup, configuration (`PORT`, `LOBBY_PASSWORD`, `CARD_CACHE_MAX_AGE_DAYS`) and draft flow.

## Stack

- TypeScript everywhere, ESM with `NodeNext` resolution. Node 20.11+ (built and tested on Node 24). npm workspaces monorepo: `shared`, `server`, `client`, `e2e`.
- Server: Express 4 + Socket.IO 4, better-sqlite3 (Scryfall card cache), run with tsx in dev.
- Client: React 19 + Vite, socket.io-client. Lint with oxlint.
- Tests: `node:test` + `node:assert/strict` via tsx (server); Playwright with Chromium (e2e).

## Commands

- Install: `npm install`, plus `npx --workspace e2e playwright install chromium` once per machine (on Linux add `--with-deps`)
- Run: `npm start` (builds shared → server → client, serves everything on :4000). Dev: `npm run dev:server` (tsx watch, :4000) and `npm run dev:client` (Vite, :5173, pointed at :4000 by `client/.env.development`)
- Test all / single: `npm test` (builds shared, then server unit + socket integration; `npm test --workspace server` skips the shared build) and `npm run test:e2e` (builds everything, runs the browser tests) / from `server/`: `node --import tsx --test src/draftEngine/draftEngine.test.ts`, or add `--test-name-pattern "enforces capacity"` for one test
- Lint / typecheck / format: `npm run lint --workspace client` (the server has no linter) / `npm run typecheck --workspace server`, `npm run typecheck --workspace e2e`, `npm run build --workspace server`, `npm run build --workspace client` / no formatter: double quotes, semicolons, lines up to about 120 characters
- Shared contract: `npm run build:shared` (emits `shared/dist`)
- Card cache: `npm run import-cards --workspace server` forces a Scryfall refresh

There is no root `lint` or `typecheck` script. More test commands, from `server/`:
```bash
node --import tsx --test "src/{draftEngine,session,cardData,cubeImport}/*.test.ts"  # unit (quoted globs need Node 21+)
node --import tsx --test "src/realtime/*.test.ts"                                   # socket integration: real Socket.IO server + clients
# everything except the three tests that need the network (Node 22.1+)
node --import tsx --test --test-skip-pattern "^(full draft over real sockets|reconnect: |rejoin mid-draft)"
```
Browser tests: `npm run test:e2e:ui` (Playwright UI mode, step through each test's trace), `npm run test:e2e:slow` (headed with slowMo to watch a draft live, `playwright.slow.config.ts`), and from `e2e/`: `npx playwright show-trace test-results/<test>/trace.zip` to replay a failed run.

Before finishing a change:
1. If `shared/` changed, run `npm run build:shared`.
2. `npm test --workspace server`.
3. `npm run build --workspace server`, `npm run typecheck --workspace server`, `npm run lint --workspace client`, `npm run build --workspace client`.
4. For UI or realtime changes, `npm run test:e2e`; for flows the two browser tests don't cover, run `dev:server` + `dev:client` and try it in two browser sessions (host and player).
5. Review `git diff` for unintended behavior changes, removed guard comments, and stray files under `server/data/` or `dist/`.

## Layout

The server is a single process that runs **one draft at a time**: one in-memory `DraftSession`, no rooms or per-draft routing, and every socket receives every `lobby:state` broadcast.

- `shared/src/` is the wire contract. `events.ts` types `ClientToServerEvents` / `ServerToClientEvents` (both ends of Socket.IO use them); client actions ack with `ActionResult` (`{ok:true,...} | {ok:false,error}`). `draft.ts` defines `DraftState`, the full persisted draft; `lobbyView.ts` defines `LobbyStateView`, its public projection.
- `server/src/`
  - `draftEngine/`: pure, synchronous state machine (deal, `submitPick`, rotate packs by `passDirection`, advance rounds). Mutates `DraftSession` in place by design; `DraftSession` adds a server-only `packQueue[round][seat]` to `DraftState`.
  - `session/`: `lobbyManager.ts` owns module-level state, validates actions and saves a snapshot after every mutation via `snapshotStore.ts`. The store is shape-agnostic: temp file, fsync, rename, with retries for Windows file locks; a corrupt snapshot is kept as `.corrupt.<ts>`. `lobbyStateView.ts` and `deckExport.ts` build outgoing views.
  - `realtime/`: `socketHandlers.ts` maps sockets to player ids (the server decides who is picking), enforces host-only actions and controls broadcast order; rejoining as an already-connected player evicts the old socket with `identity:evicted`. `lobbyPassword.ts` is the optional `LOBBY_PASSWORD` middleware, rejecting with the `"invalid_password"` marker the client checks for.
  - `cardData/` + `db/`: SQLite cache of Scryfall bulk data. Downloads on startup: blocking when empty, in the background when stale.
  - `cubeImport/`: fetches CubeCobra cube JSON from `CUBECOBRA_BASE_URL` (default `https://cubecobra.com`) and resolves names against the local DB. Keeps duplicates, reports names it can't find.
  - `images/`: `/images/:scryfallId` disk-cached proxy, so clients never call Scryfall.
  - `index.ts`: Express + Socket.IO bootstrap. Installs the password middleware, serves `client/dist` when built, and a global `unhandledRejection` backstop.
- `client/src/`
  - `socket.ts`: module-level socket singleton with `autoConnect: false`.
  - `useDraftConnection.ts`: all server-driven state and the reconnect flow (a stored playerId triggers `lobby:reconnect` on every connect).
  - `App.tsx`: screen state machine keyed on `lobbyState.status` (`empty → lobby → drafting → complete`) and whether this browser holds a seat.
  - `components/`: PascalCase `.tsx` React components.
- `e2e/`: Playwright tests that drive the production build (server serving the built client) in Chromium, one browser context per player. Each test gets its own server process, snapshot file, port and local CubeCobra stand-in.
- `server/data/` (gitignored): runtime data: card DB, image cache, `draft-session.json` snapshot.

## Conventions

- **Module boundaries**
  - `shared` has no internal dependencies. `server` and `client` depend on `shared`, **never on each other**. `e2e` depends on no workspace; it uses only the browser and HTTP.
  - `draftEngine` imports only `shared` and its own `packGenerator`; no I/O, persistence or networking.
  - Only `lobbyManager` holds session state, calls engine mutators, and saves the snapshot (via `snapshotStore`).
  - Only `socketHandlers` emits socket events. `lobby:state` is public and must never carry packs or pools; `draft:myState` and `draft:complete` go only to the owning player's socket.
  - Only `useDraftConnection` subscribes to socket events on the client. Components emit through the `socket` singleton and receive state as props.
- **Layers**: rules in `draftEngine`, state in `lobbyManager`, file persistence in `snapshotStore`, transport and ordering in `socketHandlers`. `submitPick` returns a `PickOutcome`; branch on it rather than re-deriving round state from `waitingOn`.
- **Errors**: socket handlers report failures through the `ActionResult` callback. Nothing in a handler, including `disconnect`, may throw: an uncaught error takes down every player's draft. `saveSnapshot()` never throws, because in-memory state is the source of truth; a failed write is retried in the background with the latest state.
- **Naming**: modules are camelCase `.ts` grouped by concern; components PascalCase `.tsx`. Named exports only (`App.tsx` is the only default export). Props use an `XxxProps` interface. Builders of outgoing views or keys use `build*` (`buildLobbyStateView`, `buildDeckExports`, `buildDraftPilesKey`). Socket events are `namespace:action` (`lobby:*`, `draft:*`, `cube:*`, `identity:*`). Relative imports use a `.js` extension, even from `.ts`/`.tsx`.
- **Comments** explain *why*, usually a past failure (a stuck draft, a crash, a stale pack). Keep those comments and the guards they describe, and write new ones the same way.
- **Helpers**: prefer small named functions and existing helpers (e.g. `ConfirmButton`, never `window.confirm`, which blocks socket reconnects).
- **Tests** sit next to the code as `*.test.ts` and use the existing seams: `testCard`/`testPack` (`draftEngine/testHelpers.ts`), `beginDraftWithPacks` (skips random packs), `createLobbyFromResolvedCube` (skips the network), `resetForTests(tmpPath)` (isolates snapshot state), `reloadFromSnapshotForTests()` (simulates a restart). Mock `fetch` with `t.mock.method(globalThis, "fetch", …)` to test CubeCobra imports offline.
- **Refactoring**: one concern per change; keep refactors separate from behavior changes. Before restructuring `draftEngine` or `lobbyManager`, add tests that cover current behavior.

## Gotchas

- `@draft-simulator/shared` resolves to `shared/dist`. Run `npm run build:shared` whenever `shared/src` changed or `dist` is missing, or the server and client won't see the change.
- Test files (`*.test.ts`, `testHelpers.ts`) are excluded from the server build and tsx doesn't type-check, so only `npm run typecheck --workspace server` (via `server/tsconfig.typecheck.json`) checks them.
- The first three tests in `socketHandlers.integration.test.ts` need internet (they import a real CubeCobra cube) and a populated `server/data/cards.sqlite3`. The skip pattern above matches their names; update it if you rename them. If they can't reach the network, report them as skipped or failed, not passed. The last `cubeCobraImporter.test.ts` test is skipped when the card cache is empty.
- The e2e tests need no network for the cube but do need a populated `server/data/cards.sqlite3`. Card images still load from Scryfall through the proxy; tests pass without them.
- The client has no unit tests. Split large components (`DeckBuilder.tsx`, `DraftBoard.tsx`) one step at a time, checking each step in the browser.
- `socket.ts` must stay `autoConnect: false`: `useDraftConnection` connects only after attaching listeners, so the first `connect` and `lobby:state` can't be missed.
- Read the comments in the `draft:pick` handler before reordering emits in `socketHandlers`: packs must go out before the lobby state that says it's the player's turn.
- Compatibility boundaries; change them deliberately, never as a side effect:
  - **Snapshot**: `server/data/draft-session.json` (override with `DRAFT_SNAPSHOT_PATH`) is the JSON of `LobbyManagerState`, including `DraftSession`. Shape changes break reloading a draft in progress across a server restart. Deleting the file resets a stuck draft.
  - **Card DB**: `server/data/cards.sqlite3`. Schema changes go in `getDb()` (`db/database.ts`) as additive in-place migrations: check `PRAGMA table_info`, then `ALTER TABLE`.
  - **Socket events**: a change to `shared/src/events.ts` must land in server and client in the same change.
  - **Browser storage**: renaming a `localStorage` key in `pileStorage.ts`, `playerIdentity.ts` or `lobbyPassword.ts` loses saved player state.

## Principles

- Prefer the simplest correct solution. No speculative abstractions or unrequested refactoring.
- Ask before adding dependencies.
- Follow existing conventions.
- Keep business logic free of framework/infrastructure code. Add interfaces/adapters only when a second implementation or testing requires them.
- Handle errors explicitly; never swallow failures.
- Comment intent and non-obvious decisions only.
- Minor ambiguity: assume and state the assumption. Ambiguity affecting correctness, security, or architecture: ask.

## Testing

- Unit: business rules, edge cases. Integration: infrastructure boundaries. E2E: critical user journeys only.
- Test behavior, not implementation. Minimize mocks.
- Bug fix: write a failing test first.
- Changed behavior requires added or updated tests.

## Workflow

- Read relevant code, tests, and conventions before changing anything.
- Non-trivial change: outline approach and trade-offs, then wait for approval.
- After changes, run tests, lint, and typecheck. Fix failures; never skip, weaken, or delete tests or suppress errors to pass.
- Report only checks that actually ran and passed. List anything unverified.
- Update docs when behavior, config, interfaces, or architecture change.
- Never commit secrets. Don't read or modify `.env` files.

## Git

- Never commit to main. One branch per task: `feat/<desc>`, `fix/<desc>`, `chore/<desc>`.
- Commit messages follow Conventional Commits (`feat: ...`, `fix: ...`).
- Never push to, or merge into, main without explicit permission. Never force-push.

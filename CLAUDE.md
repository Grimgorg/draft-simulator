## Project

Self-hosted Magic: The Gathering cube draft simulator for a small group of friends: one host runs the server and imports a CubeCobra cube, and players join from a browser. README.md covers user-facing setup, the downloadable executables, configuration (`PORT`, `LOBBY_PASSWORD`, `CARD_CACHE_MAX_AGE_DAYS`), releasing and draft flow.

## Stack

- TypeScript everywhere, ESM with `NodeNext` resolution. Node 22.18+ (built and tested on Node 24). npm workspaces monorepo: `shared`, `server`, `client`, `e2e`.
- Server: Express 4 + Socket.IO 4, better-sqlite3 (Scryfall card cache), run with tsx in dev.
- Client: React 19 + Vite, socket.io-client. Lint with oxlint.
- Tests: `node:test` + `node:assert/strict` via tsx (server); Playwright with Chromium (e2e).
- Executables: esbuild bundles the server to CommonJS; postject injects it into a copy of the Node binary (Node SEA). CI: GitHub Actions.

## Commands

```bash
npm install
npx --workspace e2e playwright install chromium   # once per machine (Linux: add --with-deps)

npm start                 # build everything, serve on :4000
npm run dev:server        # server with reload, :4000
npm run dev:client        # client with reload, :5173 (talks to :4000)
npm run build:shared      # after changing shared/src
npm run import-cards --workspace server   # force a Scryfall card-cache refresh
npm run build:exe         # single executable for this platform → release/
npm run smoke-test-exe --workspace server -- <executable> server/data/cards.sqlite3
```

**Tests and checks.** There are no root `lint` or `typecheck` scripts; use these.
```bash
npm test                               # server unit + socket integration tests
npm run test:e2e                       # browser tests (test:e2e:ui / test:e2e:slow to watch them)
npm run test:all                       # npm test, then test:e2e if it passes
npm run typecheck --workspace server   # also type-checks the server tests
npm run typecheck --workspace e2e
npm run lint --workspace client        # the server has no linter
npm run build --workspace server
npm run build --workspace client
```

**Single or offline tests**, from `server/`:
```bash
node --import tsx --test src/draftEngine/draftEngine.test.ts                                        # one file
node --import tsx --test --test-name-pattern "enforces capacity" src/session/lobbyManager.test.ts   # one test
node --import tsx --test --test-skip-pattern "^(full draft over real sockets|reconnect: |rejoin mid-draft)"   # all but the network tests
```
A failed browser test leaves a trace: `npx playwright show-trace test-results/<test>/trace.zip` (from `e2e/`).

**Before finishing a change:**
1. `npm run build:shared` if `shared/` changed.
2. `npm test`, both typechecks, the client lint, and both builds.
3. UI or realtime change: `npm run test:e2e`. For flows it doesn't cover, run both dev servers and try it as host and player in two browsers.
   Change to startup, paths, settings or dependencies: also `npm run build:exe` and the smoke test.
4. Check `git diff` for removed guard comments and stray files in `server/data/` or `dist/`.

## Layout

One server process runs **one draft at a time**: a single in-memory `DraftSession`, no rooms, and every socket receives every `lobby:state` broadcast.

```
shared/src/               wire contract: socket event types (events.ts), DraftState, LobbyStateView
server/src/
  index.ts                Express + Socket.IO startup; startupBanner.ts prints the port and password
  packaged/               executable-only runtime: data dir and .env next to it, embedded client and SQLite addon
  draftEngine/            draft rules: deal, pick, pass packs, advance rounds
  session/                lobbyManager (owns the state), snapshotStore (saves it), outgoing views
  realtime/               socketHandlers (all socket traffic), LOBBY_PASSWORD middleware
  cardData/, db/          SQLite cache of Scryfall card data, downloaded on startup
  cubeImport/             CubeCobra import (host set by CUBECOBRA_BASE_URL)
  images/                 /images/:scryfallId proxy, so clients never call Scryfall
server/scripts/           buildExecutable.ts, smokeTestExecutable.ts (run with tsx, type-checked by the server typecheck)
client/src/
  socket.ts               the one socket connection
  useDraftConnection.ts   all server state + reconnect flow
  App.tsx                 picks the screen: empty → lobby → drafting → complete
  components/             React components
e2e/                      Playwright tests against the production build
server/data/              runtime data, gitignored: card DB, image cache, draft snapshot
release/                  built executables, gitignored
.github/workflows/ci.yml  tests on push to main and PRs; v* tags also build, smoke-test and release the executables
```

## Conventions

**Who does what.** Each job has exactly one owner:
- `draftEngine`: the draft rules. Imports only `shared`, does no I/O, and mutates the session in place by design. `submitPick` returns a `PickOutcome`; branch on it instead of re-deriving round state from `waitingOn`.
- `lobbyManager`: the only holder of session state and the only caller of engine mutators. Saves a snapshot after every change.
- `socketHandlers`: the only code that emits socket events. The server, not the client, decides who is picking.
- `useDraftConnection`: the only client code that listens to socket events. Components send through the `socket` singleton and get state as props.
- Dependencies: `server` and `client` use `shared` but **never each other**. `e2e` uses only the browser and HTTP.

**Privacy.** `lobby:state` goes to everyone, so it must never carry packs or pools. `draft:myState` and `draft:complete` go only to the owning player's socket.

**Errors.**
- Socket handlers report failures through the ack callback (`ActionResult`: `{ok:true,...}` or `{ok:false,error}`). They must never throw, including `disconnect`: one uncaught error ends every player's draft.
- `saveSnapshot()` never throws: the in-memory state is the source of truth, and a failed write retries in the background.

**Code style.**
- Files: camelCase `.ts` modules grouped by folder, PascalCase `.tsx` components.
- Named exports only (`App.tsx` is the one default export). Component props use an `XxxProps` interface.
- Functions that build outgoing views or keys start with `build` (`buildLobbyStateView`).
- Socket events are named `namespace:action` (`lobby:*`, `draft:*`, `cube:*`, `identity:*`).
- Relative imports end in `.js`, even in `.ts`/`.tsx` files.
- No formatter: double quotes, semicolons, lines up to about 120 characters.
- Comments explain *why*, usually a past failure (a stuck draft, a crash). Keep them and the guards they describe.

**Tests.** `node:test` + `node:assert/strict`, next to the code as `*.test.ts`. Use the existing helpers:

| Helper | Use it to |
|---|---|
| `testCard`, `testPack` (`draftEngine/testHelpers.ts`) | build cards and packs |
| `beginDraftWithPacks` | start a draft with fixed instead of random packs |
| `createLobbyFromResolvedCube` | create a lobby without the network |
| `resetForTests(tmpPath)` | give a test its own snapshot file |
| `reloadFromSnapshotForTests()` | simulate a server restart |
| `setImageDirForTests(tmpDir)` | give a test its own image cache dir |
| `t.mock.method(globalThis, "fetch", …)` | fake CubeCobra responses |

Before restructuring `draftEngine` or `lobbyManager`, add tests for the current behavior. Keep refactors and behavior changes in separate commits.

## Gotchas

**Build and tests**
- The server and client read `shared/dist`, not `shared/src`. After changing `shared/src`, run `npm run build:shared` or they won't see it.
- Only `npm run typecheck --workspace server` type-checks the server tests: the build skips them and tsx doesn't type-check.
- Node below 22.18 doesn't find the `.ts` test files: `npm test` reports 0 tests and still exits 0. Check the test count.
- The first three tests in `socketHandlers.integration.test.ts` import a real cube from CubeCobra, so they need internet. The offline skip pattern above matches their names; update it if you rename them. If they can't run, report them as skipped or failed, never passed.
- Those three tests and the browser tests need the card cache (`server/data/cards.sqlite3`). The last test in `cubeCobraImporter.test.ts` skips itself without it.
- The client has no unit tests. Split big components (`DeckBuilder.tsx`, `DraftBoard.tsx`) in small steps and check each one in the browser.

**Executable** (the server runs as a CommonJS bundle inside a Node binary)
- No top-level await in server code: the bundle is CommonJS. Startup lives in `main()` in `index.ts`.
- Never use `import.meta.dirname` directly: it's undefined in the bundle. Resolve paths through `packaged/seaRuntime.ts`, which only reads it when not packaged.
- `import "./packaged/loadEnvFile.js"` must stay the first import in `index.ts`: other modules read settings as they load.
- The executable's `require()` only loads built-in modules. A new native addon or runtime file must be embedded as an asset in `buildExecutable.ts` and loaded from there.
- When packaged, the data dir and `.env` are next to the executable, not in `server/`.

**Realtime**
- Send a player's pack before the lobby state that says it's their turn. Read the comments in the `draft:pick` handler before reordering emits.
- `socket.ts` must stay `autoConnect: false`: `useDraftConnection` connects only after attaching its listeners, so the first `lobby:state` isn't missed.
- Use `ConfirmButton`, never `window.confirm`: the browser dialog blocks socket reconnects.

**Compatibility boundaries.** Change these only on purpose:

| What | Breaks if changed carelessly |
|---|---|
| Snapshot shape (`server/data/draft-session.json`, path set by `DRAFT_SNAPSHOT_PATH`) | resuming a running draft after a server restart |
| Card DB schema (`server/data/cards.sqlite3`) | existing caches. Only additive migrations, in `getDb()` (`db/database.ts`): check `PRAGMA table_info`, then `ALTER TABLE` |
| Socket events (`shared/src/events.ts`) | server and client talking. Change both in the same commit |
| Executable layout (`data/` and `.env` next to the executable, asset names in `buildExecutable.ts`) | hosts' existing data and settings after updating the executable |
| `localStorage` keys (`pileStorage.ts`, `playerIdentity.ts`, `lobbyPassword.ts`) | players' saved identity (their seat), piles, deck state and lobby password |

To reset a stuck draft, delete `server/data/draft-session.json`.

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

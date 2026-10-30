## Project

Self-hosted Magic: The Gathering cube draft simulator for a small group of friends: one host runs the server and imports a CubeCobra cube or picks a set to draft from its boosters, and players join from a browser. The host installs a Tauri desktop app whose window is the server's management UI (on `127.0.0.1:4001` when run from source). README.md is for hosts only: the installers and where they keep data, the management UI, updates, configuration (`PORT`, `LOBBY_PASSWORD`, `CARD_CACHE_MAX_AGE_DAYS`) and draft flow. DEVELOPMENT.md covers running from source, `MANAGEMENT_PORT`, tests, the desktop app's dev setup, building and releasing.

## Stack

- TypeScript everywhere, ESM with `NodeNext` resolution. Node 22.18+ (built and tested on Node 24). npm workspaces monorepo: `shared`, `server`, `client`, `e2e`, `desktop`.
- Server: Express 4 + Socket.IO 4, better-sqlite3 (Scryfall card cache), run with tsx in dev.
- Client: React 19 + Vite, socket.io-client. Lint with oxlint.
- Tests: `node:test` + `node:assert/strict` via tsx (server); Playwright with Chromium (e2e).
- Executables: esbuild bundles the server to CommonJS; postject injects it into a copy of the Node binary (Node SEA). CI: GitHub Actions.
- Desktop app: Tauri 2 (Rust, `desktop/src-tauri/`) runs that executable as its sidecar and shows the management UI in its window. Releases ship its installers (NSIS, dmg, AppImage, deb), not the bare executable.

## Commands

```bash
npm install
npx --workspace e2e playwright install chromium   # once per machine (Linux: add --with-deps)

npm start                 # build everything, serve on :4000, management UI on 127.0.0.1:4001
npm run dev:server        # server with reload, :4000 and management on :4001
npm run dev:client        # client with reload, :5173 (talks to :4000); management UI at :5173/manage.html
npm run build:shared      # after changing shared/src
npm run import-cards --workspace server   # force a Scryfall card-cache refresh
npm run build:exe         # single executable for this platform → release/, also copied to desktop/src-tauri/binaries/
npm run smoke-test-exe --workspace server -- <executable> server/data/cards.sqlite3
npm run dev:desktop       # the desktop window with dev:server + dev:client behind it (needs Rust)
npm run build:desktop     # build:exe, the notices, then the installers → desktop/src-tauri/target/release/bundle/
                          # (needs cargo-about: cargo install --locked --features cli cargo-about@0.9.2)
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
   Change to `desktop/` or to how the server starts: also `npm run typecheck --workspace desktop`, `cargo clippy` in `desktop/src-tauri`, and `npm run build:desktop`, then start the built app and quit it.
4. Check `git diff` for removed guard comments and stray files in `server/data/` or `dist/`.

## Layout

One server process runs **many drafts at once** (at most `MAX_OPEN_DRAFTS` unfinished): `lobbyManager` keeps them in memory, keyed by draft id (the session's id). Each draft's seated sockets share a Socket.IO room, `draft:<id>`, and only they get its `lobby:state`; every socket gets `drafts:list`. A socket is seated in at most one draft. The process runs two HTTP + Socket.IO servers: the **management server** (127.0.0.1 only, always up) and the **draft server** players use, which the management server starts and stops.

```
shared/src/               wire contract: socket event types (events.ts, managementEvents.ts), DraftState, LobbyStateView
server/src/
  index.ts                startup: management server, card DB check, then the draft server
  management/             draftServer (player-facing server, start/stop), managementServer (the host's UI and manage:* events),
                          settingsFile (PORT and LOBBY_PASSWORD in .env), logBuffer (console capture for the log viewer),
                          openInBrowser (opens the player page or the repo in the host's default browser)
  packaged/               executable-only runtime: data dir and .env next to it, embedded client and SQLite addon
  draftEngine/            draft rules: deal, pick, pass packs, advance rounds; winstonDraft (two-player Winston draft,
                          from docs/winston-draft.md)
  session/                lobbyManager (owns every draft), snapshotStore (saves them), outgoing views
  realtime/               socketHandlers (all socket traffic), LOBBY_PASSWORD middleware
  cardData/, db/          SQLite cache of Scryfall card data, downloaded on startup: one printing per card (`cards`), and
                          every printing of the sets set drafts open (`set_printings`)
  setBoosters/            set drafts' packs: one booster per set, built from docs/sets/<set>.md (realityFracture)
  cubeImport/             CubeCobra import (host set by CUBECOBRA_BASE_URL)
  images/                 /images/:scryfallId proxy, so clients never call Scryfall
server/scripts/           buildExecutable.ts, smokeTestExecutable.ts (run with tsx, type-checked by the server typecheck)
client/src/
  socket.ts               the one socket connection
  useDraftConnection.ts   all server state + reconnect flow
  App.tsx                 picks the screen: draft list → join → lobby → drafting → complete
  components/             React components
  management/             the management UI (manage.html): its own socket, useManagementConnection, panels
e2e/                      Playwright tests against the production build
docs/sets/                one researched booster reference per set (slots, odds, special rules): the spec for set-draft packs
docs/winston-draft.md     Winston draft's rules and the house rules for an empty stack: the spec for winstonDraft.ts
desktop/                  Tauri app: src-tauri/src/main.rs (starts the server, shows its UI, stops it, offers updates),
                          splash/ (page shown while it starts), scripts/devServers.ts (dev:desktop's servers), app-icon.svg (source of src-tauri/icons)
server/data/              runtime data, gitignored: card DB, image cache, draft snapshot
release/                  built executables, gitignored (as are desktop/src-tauri/{target,gen,binaries})
.github/workflows/ci.yml  on pull requests into main and dev: tests, clippy, dependency audit, version check, and building and
                          smoke-testing the installers; pushes to main and dev also release them. The rulesets require these
                          checks by job name, and codeql.yml's
.github/dependabot.yml    weekly update PRs into dev; they need a version bump pushed to their branch before they can pass
```

## Conventions

**Who does what.** Each job has exactly one owner:
- `draftEngine`: the draft rules. Imports only `shared`, does no I/O, and mutates the session in place by design. `submitPick` returns a `PickOutcome`; branch on it instead of re-deriving round state from `waitingOn`.
- `setBoosters`: a set's pack layout. Like `draftEngine`, imports only `shared` and does no I/O: it gets the set's
  printings from `lobbyManager` and a random source, so tests can seed it. Its rules and odds come from the set's
  file in `docs/sets/`; change both together.
- `lobbyManager`: the only holder of session state and the only caller of engine mutators. Saves a snapshot after every change.
- `socketHandlers`: the only code that emits player socket events. The server, not the client, decides who is picking.
- `managementServer`: the only code that emits `manage:*` events, and the only caller of `startDraftServer`/`stopDraftServer`. It learns about changes from `lobbyManager.onStateChange`, `onDraftServerChange` and `onLog`.
  Players create drafts (`draft:create`, which seats its creator) and join them (`lobby:join`). A draft's creator is its first player (`getCreatorPlayerId`), the only one who can `draft:start` and `draft:close` it; the server checks. The host can only close drafts, from the management UI, through `socketHandlers`' `closeDraft`, which tells their players.
- `useDraftConnection`: the only client code that listens to player socket events. Components send through the `socket` singleton and get state as props.
- `useManagementConnection`: the same for the management UI and its `managementSocket` singleton.
- Dependencies: `server` and `client` use `shared` but **never each other**. `e2e` uses only the browser and HTTP.

**Privacy.** `lobby:state` goes to everyone in a draft and `drafts:list` to everyone connected, so neither may carry packs or pools, and one draft's events never go to another draft's room. `draft:myState` and `draft:complete` go only to the owning player's socket. `manage:state` carries no packs or pools either: the host is a player too.

**Management security.** The management server listens on 127.0.0.1 and refuses any request whose `Host` or `Origin` isn't loopback (`isAllowedManagementRequest`), so websites the host visits can't drive it. Keep both when adding routes.

**Errors.**
- Socket handlers report failures through the ack callback (`ActionResult`: `{ok:true,...}` or `{ok:false,error}`). They must never throw, including `disconnect`: one uncaught error ends every player's draft. The same goes for `manage:*` handlers.
- `startDraftServer` and `stopDraftServer` return an `ActionResult` and never throw: a busy port is shown in the management UI, not a reason to exit.
- `lobbyManager` and `logBuffer` listeners run inside picks and console calls, so their errors are caught and logged.
- `saveSnapshot()` never throws: the in-memory state is the source of truth, and a failed write retries in the background.

**Code style.**
- Files: camelCase `.ts` modules grouped by folder, PascalCase `.tsx` components.
- Named exports only (`App.tsx` is the one default export). Component props use an `XxxProps` interface.
- Functions that build outgoing views or keys start with `build` (`buildLobbyStateView`).
- Socket events are named `namespace:action` (`lobby:*`, `draft:*`, `identity:*`).
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

Before restructuring `draftEngine` or `lobbyManager`, add tests for the current behavior.

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
- `import "./management/captureConsole.js"` must stay the first import in `index.ts`, so the log viewer gets everything; `import "./packaged/loadEnvFile.js"` must come right after, before any module that reads settings as it loads.
- The executable's `require()` only loads built-in modules. A new native addon or runtime file must be embedded as an asset in `buildExecutable.ts` and loaded from there.
- When packaged, the data dir and `.env` are in `DRAFT_SIMULATOR_HOME` (the desktop app sets it to the OS app data folder), or next to the executable without it. Never in `server/`.

**Desktop app**
- The app finds the management UI by reading the server's `Management UI: <url>` line, and passes `MANAGEMENT_PORT=0`, `DRAFT_SIMULATOR_HOME` and `DRAFT_SIMULATOR_MANAGED=1`. With the last one, the server exits when its stdin closes, so it can't outlive a crashed app, and starts the draft server only to resume an open or running draft (`shouldStartDraftServerAtLaunch`, any of them): otherwise the host starts it. Run from source, it always starts.
- `tauri.bundle.conf.json` holds the settings that need `build:exe` and `notices` to have run (the sidecar and `desktop/src-tauri/THIRD_PARTY_NOTICES.txt`, which `desktop/scripts/buildNotices.ts` builds from the server's notices plus cargo-about's list of Rust crates). Only `build:desktop` merges it in, so `dev:desktop` and CI's clippy work without the executable.
- macOS `hardenedRuntime` must stay `false`: Tauri re-signs the bundled server, and with the hardened runtime V8 can't reserve memory for its JIT, so the server crashes at start. CI smoke-tests the server inside the `.app` for this reason.
- The window shows the bundled start page (`desktop/splash/`), then loads `http://127.0.0.1:<port>`. It has no capabilities:
  no page can call Rust. Keep it that way. The updater runs from Rust only; the start page's buttons reach it only by going
  to `draft-simulator.invalid` addresses, which `on_navigation` catches (`choose` in `main.rs`).
- Updates: release builds check `releases/latest/download/latest.json` at start, before starting the server, and ask on the
  start page before installing (`check_for_update` in `main.rs`, with a 10-second timeout). The update files are signed
  with a key held only in the repo secrets `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)`; the app accepts only that key
  (`plugins.updater.pubkey`). Only CI passes `tauri.updater.conf.json`, which builds the signed
  bundles, so a local `build:desktop` needs no key. `publish-release` writes `latest.json` while the release is still a draft.
- Links in the management UI would replace it in the app's only window. Show addresses as text with a copy button, and
  open pages through `manage:openInBrowser`, which takes a fixed target, never a URL: the server hands it to a shell on Windows.
- A new Rust dependency under a license missing from `accepted` in `desktop/src-tauri/about.toml` fails `notices` and CI. Check the license before adding it there. cargo-about's version is pinned (`CARGO_ABOUT_VERSION` in CI); 0.9 only installs its binary with `--features cli`, and without it `cargo install` succeeds without installing anything.

**Realtime**
- Send a player's pack before the lobby state that says it's their turn. Read the comments in the `draft:pick` handler before reordering emits.
- `socket.ts` and `managementSocket.ts` must stay `autoConnect: false`: their hooks connect only after attaching their listeners, so the first state isn't missed.
- On macOS a port held on 127.0.0.1 can still be opened on 0.0.0.0, so a busy management port doesn't stop the draft server from taking it. `validateSettings` refuses the management port for players.
- Use `ConfirmButton`, never `window.confirm`: the browser dialog blocks socket reconnects.

**Compatibility boundaries.** Change these only on purpose:

| What | Breaks if changed carelessly |
|---|---|
| Snapshot shape (`server/data/draft-session.json`, path set by `DRAFT_SNAPSHOT_PATH`): `{ drafts: [...] }`; `fromSnapshot` still reads the old single-draft shape | resuming running drafts after a server restart or an update |
| Card DB schema (`server/data/cards.sqlite3`) | existing caches. Only additive migrations, in `getDb()` (`db/database.ts`): check `PRAGMA table_info`, then `ALTER TABLE`, or add a table. When existing caches lack the new data, mark them stale (delete `last_imported_at`), and bump CI's card cache key |
| Socket events (`shared/src/events.ts`, `managementEvents.ts`) | server and client talking. Change both in the same commit |
| Executable layout (`data/` and `.env` in `DRAFT_SIMULATOR_HOME` or next to the executable, asset names in `buildExecutable.ts`) | hosts' existing data and settings after updating |
| Tauri `identifier` (`desktop/src-tauri/tauri.conf.json`) | the app data folder's name: changing it loses hosts' data and settings |
| `.env` lines the management UI writes (`PORT`, `LOBBY_PASSWORD` double-quoted) | settings hosts saved in the UI |
| The `Management UI: <url>` line `index.ts` prints | the desktop app, which reads it to find the UI (`UI_LINE_PREFIX` in `main.rs`) |
| Release asset names, `latest.json` and its URL, the updater `pubkey` | updating installed apps: they'd find no update, or refuse it |
| `tauri.beta.conf.json` (beta `identifier`, `beta-channel/latest.json` URL); `beta-channel` staying a prerelease | installed betas' data and updates; as the latest release it would send betas to stable apps |
| `localStorage` keys (`pileStorage.ts`, `playerIdentity.ts`, `lobbyPassword.ts`) | players' saved identity (their seat), piles, deck state and lobby password |

To reset every draft, delete `server/data/draft-session.json`; to end one, close it in the management UI.

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
- Before restructuring a core module, add tests for its current behavior.
- A test that couldn't run is reported as skipped or failed, never as passed.

## Workflow

- Read relevant code, tests, and conventions before changing anything.
- Non-trivial change: outline approach and trade-offs, then wait for approval.
- After changes, run tests, lint, and typecheck. Fix failures; never skip, weaken, or delete tests or suppress errors to pass.
- Before opening a PR: run every check in *Commands › Before finishing a change*, plus the extra checks the change calls for.
- Report only checks that actually ran and passed. List anything unverified.
- Update docs when behavior, config, interfaces, or architecture change.
- Never commit secrets or generated/local files (extend `.gitignore`). Don't read or modify `.env` files.

## Git

- Never commit to main. One branch per task: `feat/<desc>`, `fix/<desc>`, `chore/<desc>`.
- Commit messages and PR titles follow Conventional Commits (`feat:`, `fix:`, `chore:`, `ci:`, `docs:`, `test:`, `refactor:`).
- Every branch bumps the root `package.json` version (`npm version patch --no-git-tag-version`): each merge into main
  publishes it as a release, and CI fails a version that isn't higher than the latest release.
- `dev` is the beta channel: branches for it start from `dev`, PR into `dev`, and bump with
  `npm version prerelease --preid beta --no-git-tag-version` (the first beta after a release: `preminor`). Each merge
  publishes a prerelease of "Draft Simulator Beta" (`tauri.beta.conf.json`). DEVELOPMENT.md › *Betas from `dev`* has
  the release flow, including bringing `main` back into `dev` with a merge commit.
- PR descriptions follow `.github/pull_request_template.md`.
- Merge pull requests with a squash commit (`gh pr merge --squash`), the only method main's ruleset allows. The commit
  takes the PR's title and description.
- After a squash merge, `git branch -d` refuses the local branch, because its commits aren't on main. Check that the
  PR is merged, then use `-D`.
- Never push to, or merge into, main without explicit permission. Never force-push.
- `.claude/hooks/guard-main.sh` blocks commit, push and merge while `main` is checked out; `.claude/settings.json`
  denies force-pushes and `.env` access.

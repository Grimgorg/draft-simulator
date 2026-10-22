# Draft Simulator

A self-hosted Magic: The Gathering cube draft simulator for a small group of friends. One person runs the server on their PC, imports a cube from [CubeCobra](https://cubecobra.com), and everyone else joins over the browser to draft together — packs, pass-direction rotation, live "who's still picking" status, and a decklist export at the end.

Developed with the help of AI coding assistants (Claude Code).

## Download and run (no Node needed)

Only the host runs the server. Everyone else just opens its address in a browser.

1. Download the file for your computer from the repository's [Releases](https://github.com/Grimgorg/draft-simulator/releases) page.
   - Windows: `draft-simulator-windows-x64.zip`
   - Mac with Apple Silicon (M1 and newer): `draft-simulator-macos-arm64.tar.gz`
   - Intel Mac: `draft-simulator-macos-x64.tar.gz`
   - Linux: `draft-simulator-linux-x64.tar.gz`
2. Unpack it into a folder of its own, then start it: double-click it, or run `./draft-simulator-…` in a terminal. Keep the window open while you draft. Closing it stops the server.
3. The window shows the address of the **management UI**, `http://127.0.0.1:4001/`. Open it in a browser on the same computer; only that computer can open it. The first start downloads the card database, which takes a minute, and the management UI's log shows how far along it is.

The management UI is where the host runs the server:
- **Server:** whether it's running, with buttons to start, stop and restart it. Stopping disconnects everyone but keeps the draft; players get their seats back once it runs again.
- **Invite players:** the addresses to send friends, the port to forward and the lobby password.
- **Current draft** and **Players:** the cube, the pack and pick, and who is connected and still picking.
- **Settings:** the port and the lobby password. Saving writes them to `.env`; restart the server to use them. Set a lobby password before forwarding the port.
- **Log:** everything the server logs, with a filter for warnings and errors.

Everything the server stores goes next to the executable: a `data/` folder with the card database, image cache and running draft, and a `.env` settings file. The first start creates the `.env` with every setting commented out. The management UI saves the port and password there; for the other settings, remove the `#` in front of the line (see [Configuration](#configuration)) and restart.

**First-start warnings.** The executables aren't code-signed, so the system warns you the first time:
- **macOS:** "cannot be opened because the developer cannot be verified". Right-click the file, choose **Open**, then **Open** again. Or run `xattr -d com.apple.quarantine draft-simulator-macos-*` in that folder.
- **Windows:** SmartScreen says "Windows protected your PC". Click **More info**, then **Run anyway**. When the firewall asks, allow access, otherwise friends can't connect.

**Friends outside your network** need the port forwarded. In your router's settings, forward the TCP port shown in the management UI (4000 by default) to this computer. Then send them `http://<your public IP>:4000`. Searching "what is my IP" shows your public IP.

## Requirements (running from source)

- **Node.js 22.18+** (LTS recommended; this project was built and tested on Node 24)
- Internet access, at least for first-time setup (to download Scryfall's card database and to import cubes from CubeCobra)

If you don't have Node installed, the easiest way is via [nvm](https://github.com/nvm-sh/nvm):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# restart your terminal, then:
nvm install --lts
nvm use --lts
```

## First-time setup

```bash
npm install
```

`npm install` installs dependencies for all four workspaces (`shared`, `server`, `client`, `e2e`). It may ask you to approve a couple of native install scripts (`better-sqlite3`, `esbuild`, `fsevents`) the first time — these are already recorded as approved in `package.json`, so a normal clone shouldn't prompt again.

The Scryfall card database (~38,000 cards, cached locally at `server/data/cards.sqlite3` so the app can resolve cube card lists and serve card images without hitting Scryfall on every request) no longer needs a manual import step: the server checks it on every startup and downloads it automatically if it's missing or older than 30 days, so `npm start` alone bootstraps everything on a fresh clone. Startup blocks briefly only the very first time (nothing works with zero cached cards); a routine refresh of an already-populated cache happens in the background so the server is usable immediately. Override the staleness threshold with `CARD_CACHE_MAX_AGE_DAYS` (e.g. `CARD_CACHE_MAX_AGE_DAYS=7 npm start`), or force a refresh manually any time with `npm run import-cards --workspace server`.

## Running it

### Quick start (recommended)

```bash
npm start
```

This builds `shared`, `server`, and `client`, then starts the server at **http://localhost:4000** and the management UI at **http://127.0.0.1:4001** (see [Download and run](#download-and-run-no-node-needed) for what it shows). Open http://localhost:4000 to play; that's the host's screen too. Anyone else on the same network can join by opening `http://<your-computer's-LAN-IP>:4000` in their own browser.

### Development mode

For iterating on the code, run these in two separate terminals instead:

```bash
npm run dev:server   # server with auto-reload, port 4000
npm run dev:client   # Vite dev server with hot reload, port 5173
```

In dev mode, use the client on port 5173 (it's pre-configured via `client/.env.development` to talk to the server on 4000), and the management UI at http://localhost:5173/manage.html (it talks to the management server on 4001).

### Configuration

Settings are environment variables the server reads at startup. They can come from a `.env` file: `server/.env` for `npm start` and `npm run dev:server` (create it yourself; it isn't in the repository), or the `.env` next to the executable. A real environment variable takes precedence over the same setting in `.env`.

- `PORT` — defaults to `4000`. Also set in the management UI.
- `CARD_CACHE_MAX_AGE_DAYS` — defaults to `30`; see the card database note above.
- `LOBBY_PASSWORD` — unset by default (no password required). If set, everyone must enter this password before they can connect at all — useful if you're exposing the server beyond your LAN (e.g. port-forwarding it to the internet for a remote draft). It's a single shared password for the whole server, not per-draft. Also set in the management UI.
- `MANAGEMENT_PORT` — defaults to `4001`. The management UI listens on this port on `127.0.0.1` only, so other computers can't open it. `0` picks any free port.

The management UI saves the port and password to the `.env` file. A real environment variable still wins when the app starts, so with `PORT` or `LOBBY_PASSWORD` set in the environment, a saved value only lasts until the next start.

## How a draft works

1. The host opens the app, pastes a CubeCobra cube URL (or ID), sets the number of players / packs / cards per pack, and clicks **Create draft**.
2. Everyone else opens the same URL and joins with their name.
3. Once every seat is filled, the host clicks **Start draft**.
4. Everyone picks from their own pack each round; packs rotate automatically once everyone's picked. There's no time limit.
5. If someone's browser refreshes or their connection drops, reopening the same URL in the same browser resumes them automatically. If it's a new browser or device (or the old one lost its storage), open the URL and pick your name from the "Rejoin as..." list — this works at any point in the draft, not just the lobby.
6. Once the last pack is empty, everyone gets their own pool and can copy or download their picks as a decklist.

## Project structure

- `shared/` — TypeScript types and Socket.IO event contracts shared between client and server
- `server/` — Express + Socket.IO backend: Scryfall card cache, CubeCobra importer, draft engine, session/reconnect handling, and the management server that starts and stops it
- `client/` — React frontend: the player client (`index.html`) and the management UI (`manage.html`)
- `e2e/` — Playwright browser tests that play a draft as host and guest, and drive the management UI

## Tests

Server tests sit next to the code they test, as `*.test.ts` (for example `server/src/draftEngine/draftEngine.test.ts`), so each folder shows its code and its tests together. Tests that run a real server over sockets end in `.integration.test.ts`. The browser tests live in their own workspace, `e2e/tests/`, because they exercise the whole app rather than one module. The client has no unit tests of its own; the browser tests cover it.

```bash
npm test                                   # server unit and socket integration tests
npx --workspace e2e playwright install chromium   # once, before the first browser test run
npm run test:e2e                           # browser tests: a host and a guest draft in real Chromium, and the management UI
npm run test:e2e:ui                        # the same browser tests in Playwright's UI, to step through each one afterwards
npm run test:e2e:slow                      # the same browser tests slowed down in visible windows, to watch live
npm run test:all                           # server tests, then the browser tests if those pass
```

In the UI, click a test's name once it has run to see its steps; it doesn't play them back live. The slow run opens a host and a guest browser window and waits half a second before each action, so a whole draft takes about 10 seconds. Change `slowMo` in `e2e/playwright.slow.config.ts` to speed it up or slow it down.

Playwright is installed by the `e2e` workspace, so if you pulled that workspace into an existing checkout, run `npm install` again before the browser tests. Otherwise the `test:e2e` scripts fail with `'playwright' is not recognized` (or `playwright: command not found`).

Most tests are network-free. Three socket integration tests need internet access (they import a real CubeCobra cube), and both those and the browser tests need the local card cache from the setup step above.

## Building the executables and releasing

```bash
npm run build:exe   # builds release/draft-simulator-<os>-<arch> for the computer you run it on
npm run smoke-test-exe --workspace server -- release/draft-simulator-macos-arm64 server/data/cards.sqlite3
```

The executable is a copy of the Node binary that runs the build, with the server, the built client and SQLite's native addon embedded (Node's [single executable applications](https://nodejs.org/api/single-executable-applications.html)). It can only be built for the platform you're on, so GitHub Actions builds each platform on its own runner. The build also writes `release/THIRD_PARTY_NOTICES.txt` with the licenses of Node.js and every npm package inside the executable, and each download includes it. If Node's license file isn't next to your Node install, the build downloads it for your Node version from GitHub.

GitHub Actions (`.github/workflows/ci.yml`) runs the typechecks, lint, builds, server tests and browser tests on every push to every branch. Every merge into `main` publishes a release, so every pull request has to raise the version in the root `package.json`:

```bash
npm version patch --no-git-tag-version   # or minor / major; updates package.json and package-lock.json
```

Each push also checks that this version is higher than the latest GitHub Release, and the check fails if it isn't. Once a pull request with a passing check is merged, the workflow tests `main` again, builds and smoke-tests the executable on Linux, Windows, Apple Silicon and Intel Macs, and publishes all four as Release `v<version>`, tagging the merged commit. Nothing is released if a test, a build or the version check fails. Versions must be plain `1.2.3`; there are no pre-releases.

To make GitHub refuse merging a pull request that fails a test or the version check, add a rule for `main` under **Settings → Rules** that requires the `test` and `version` status checks. Without it, such a merge goes through and the run on `main` fails instead, without releasing anything. Releasing needs no secrets.

To build and smoke-test the executables without releasing them, run the workflow by hand: **Actions → CI → Run workflow**. The workflow never stores files as workflow artifacts, because artifact storage is shared by all your private repos and can fill up. The executables go straight onto the Release, whose files don't count toward that limit.

## Known limitations

- One draft at a time per server instance — the host has to finish (or the host can start a fresh one from the results screen) before a new one can begin.
- Identity is trust-based, not authenticated: the "Rejoin as..." list shows every player's name and lets anyone pick any seat, since this is meant for a small group of friends who trust each other, not a public server. Picking a name that's still connected elsewhere signs that other session out. If a draft ever gets stuck beyond that, quit Draft Simulator and delete `server/data/draft-session.json` (or `data/draft-session.json` next to the executable) to reset it. If you're exposing the server beyond your LAN, set `LOBBY_PASSWORD` (see Configuration above) so a stranger who finds the URL can't connect at all.

## License

[MIT](LICENSE). Anyone may use, change and share this code, including commercially, as long as they keep the copyright notice.

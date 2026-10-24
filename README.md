# Draft Simulator

A self-hosted Magic: The Gathering cube draft simulator for a small group of friends. One person runs the server on their PC, imports a cube from [CubeCobra](https://cubecobra.com), and everyone else joins over the browser to draft together — packs, pass-direction rotation, live "who's still picking" status, and a decklist export at the end.

Developed with the help of AI coding assistants (Claude Code).

## Download and run (no Node needed)

Only the host installs Draft Simulator. Everyone else just opens its address in a browser.

1. Download the installer for your computer from the repository's [Releases](https://github.com/Grimgorg/draft-simulator/releases) page.
   - Windows: `draft-simulator-windows-x64-setup.exe`
   - Mac with Apple Silicon (M1 and newer): `draft-simulator-macos-arm64.dmg`
   - Intel Mac: `draft-simulator-macos-x64.dmg`
   - Linux: `draft-simulator-linux-x64.AppImage` (make it executable, then run it), or `draft-simulator-linux-x64.deb`
2. Install it: run the Windows installer, or drag Draft Simulator from the `.dmg` into Applications.
3. Start Draft Simulator. Its window is the **management UI**, from which you run the server. The server runs while the window is open; closing it stops the server. The first start downloads the card database, which takes a minute, and the **Logs** tab shows how far along it is.

The management UI has three tabs:
- **Draft**, with these panels:
  - **Server:** whether it's running, with buttons to start, stop and restart it. Stopping disconnects everyone but keeps the draft; players get their seats back once it runs again.
  - **Invite players:** the addresses to send friends, the port to forward and the lobby password. **Open in browser** opens the player page in your default browser, where you play too.
  - **Current draft** and **Players:** the cube, the pack and pick, and who is connected and still picking.
- **Settings:** the port and the lobby password. Saving writes them to the settings file; restart the server to use them. Set a lobby password before forwarding the port. The tab shows "Restart required" until you do.
- **Logs:** everything the server logs, with a filter for warnings and errors. The tab shows how many warnings and errors there are.

The footer shows the app's version and the address of this repository.

Everything the server stores goes in your user's app data folder: a `data/` folder with the card database, image cache and running draft, and a `.env` settings file.
- Windows: `%APPDATA%\io.github.grimgorg.draft-simulator`
- macOS: `~/Library/Application Support/io.github.grimgorg.draft-simulator`
- Linux: `~/.local/share/io.github.grimgorg.draft-simulator`

The management UI saves the port and password in `.env`. For the other settings, remove the `#` in front of the line (see [Configuration](#configuration)) and restart.

**Updating from 0.2 or older.** Those versions were a single executable that kept `data/` and `.env` next to itself. The app doesn't use that folder. On the first start it downloads the card database again, and you set the port and password once in Settings. A draft running at the moment you update isn't carried over. Once the app works, you can delete the old executable's folder.

**First-start warnings.** The app isn't code-signed, so the system warns you the first time:
- **macOS:** "Draft Simulator can't be opened" or "is damaged". Open **System Settings → Privacy & Security** and click **Open Anyway** next to Draft Simulator. Or run `xattr -cr "/Applications/Draft Simulator.app"` in Terminal once.
- **Windows:** SmartScreen says "Windows protected your PC". Click **More info**, then **Run anyway**. When the firewall asks about `draft-simulator-server`, allow access, otherwise friends can't connect.

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

### The desktop app

The installed app is a [Tauri](https://tauri.app) window (`desktop/`) around the same server: it starts the server executable, shows its management UI and stops the server when it closes. Working on it needs [Rust](https://rustup.rs) and Tauri's [system prerequisites](https://tauri.app/start/prerequisites/) (Xcode Command Line Tools on macOS, WebView2 and the MSVC build tools on Windows, WebKitGTK on Linux).

```bash
npm run dev:desktop    # the app window, with the server and client in dev mode behind it (stop both by closing the window)
npm run build:desktop  # the installers for this computer, in desktop/src-tauri/target/release/bundle/
```

`build:desktop` also needs [cargo-about](https://github.com/EmbarkStudios/cargo-about), which lists the Rust crates' licenses: `cargo install --locked --features cli cargo-about@0.9.2`.

`dev:desktop` runs `dev:server` and `dev:client` itself, so don't run them alongside it.

### Configuration

Settings are environment variables the server reads at startup. They can come from a `.env` file: `server/.env` for `npm start` and `npm run dev:server` (create it yourself; it isn't in the repository), or the `.env` in the desktop app's data folder (see [Download and run](#download-and-run-no-node-needed)). A real environment variable takes precedence over the same setting in `.env`.

- `PORT` — defaults to `4000`. Also set in the management UI.
- `CARD_CACHE_MAX_AGE_DAYS` — defaults to `30`; see the card database note above.
- `LOBBY_PASSWORD` — unset by default (no password required). If set, everyone must enter this password before they can connect at all — useful if you're exposing the server beyond your LAN (e.g. port-forwarding it to the internet for a remote draft). It's a single shared password for the whole server, not per-draft. Also set in the management UI.
- `MANAGEMENT_PORT` — defaults to `4001`. The management UI listens on this port on `127.0.0.1` only, so other computers can't open it. `0` picks any free port, which is what the desktop app uses.

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
- `desktop/` — the Tauri desktop app: a window around the server executable (`src-tauri/`), its loading page and its icon

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

## Building the app and releasing

```bash
npm run build:exe       # the server executable, release/draft-simulator-<os>-<arch>, for the computer you run it on
npm run smoke-test-exe --workspace server -- release/draft-simulator-macos-arm64 server/data/cards.sqlite3
npm run build:desktop   # build:exe, then the desktop app's installers around it (needs Rust and cargo-about, see above)
```

The server executable is a copy of the Node binary that runs the build, with the server, the built client and SQLite's native addon embedded (Node's [single executable applications](https://nodejs.org/api/single-executable-applications.html)). `build:exe` also copies it into `desktop/src-tauri/binaries/`, where the desktop app picks it up. It runs on its own too, keeping `data/` and `.env` next to itself, which is how the smoke test runs it. Both can only be built for the platform you're on, so GitHub Actions builds each platform on its own runner. The build also writes `release/THIRD_PARTY_NOTICES.txt` with the licenses of Node.js and every npm package inside the executable. If Node's license file isn't next to your Node install, the build downloads it for your Node version from GitHub. `build:desktop` then adds the licenses of the Rust crates compiled into the app, collected by cargo-about, and every installer includes the combined `THIRD_PARTY_NOTICES.txt`. A crate whose license isn't in the `accepted` list in `desktop/src-tauri/about.toml` fails the build (and CI's `desktop` check) until someone has checked that license and added it.

GitHub Actions (`.github/workflows/ci.yml`) runs on every pull request into `main`, and again on each push to it. It runs the typechecks, lint, builds, server tests and browser tests, and lints the desktop app's Rust code with clippy. It also builds and smoke-tests the installers for Linux, Windows, Apple Silicon and Intel Macs, without releasing them. A branch without a pull request isn't checked; run `npm run test:all` locally. Every merge into `main` publishes a release, so every pull request has to raise the version in the root `package.json`:

```bash
npm version patch --no-git-tag-version   # or minor / major; updates package.json and package-lock.json
```

Each run also checks that this version is higher than the latest GitHub Release, and the check fails if it isn't. Once a pull request with passing checks is merged, the workflow tests `main` again, builds and smoke-tests the server executable on Linux, Windows, Apple Silicon and Intel Macs, builds the desktop app's installers around it, and publishes them as Release `v<version>`, tagging the merged commit. Nothing is released if a test, a build or the version check fails. Versions must be plain `1.2.3`; there are no pre-releases.

GitHub refuses to merge a pull request until these checks pass, because the `protect` rule for `main` under **Settings → Rules** requires them: `test`, `desktop`, `version`, `package (linux-x64)`, `package (windows-x64)`, `package (macos-arm64)` and `package (macos-x64)`. A job renamed in `ci.yml` must be renamed in that rule too, or nothing can be merged. The rule also makes every change to `main` go through a pull request, and stops `main` from being deleted or force-pushed. It allows only squash merges, so each pull request lands on `main` as one commit named after the pull request's title. Under **Settings → General → Pull Requests**, merge commits and rebase merging are turned off, and squash commits use the pull request's title and description as their message. Without the rule, a failing pull request could be merged, and the run on `main` would then fail without releasing anything. Releasing needs no secrets.

To build and smoke-test the installers without releasing them, run the workflow by hand: **Actions → CI → Run workflow**. The workflow never stores files as workflow artifacts, because artifact storage is shared by all your private repos and can fill up. The installers go straight onto the Release, whose files don't count toward that limit.

## Known limitations

- One draft at a time per server instance — the host has to finish (or the host can start a fresh one from the results screen) before a new one can begin.
- Identity is trust-based, not authenticated: the "Rejoin as..." list shows every player's name and lets anyone pick any seat, since this is meant for a small group of friends who trust each other, not a public server. Picking a name that's still connected elsewhere signs that other session out. If a draft ever gets stuck beyond that, quit Draft Simulator and delete `data/draft-session.json` in its app data folder (or `server/data/draft-session.json` when running from source) to reset it. If you're exposing the server beyond your LAN, set `LOBBY_PASSWORD` (see Configuration above) so a stranger who finds the URL can't connect at all.

## License

[MIT](LICENSE). Anyone may use, change and share this code, including commercially, as long as they keep the copyright notice.

# Developing Draft Simulator

How to run Draft Simulator from source, test it, build the desktop app and release it. For installing and using the app, see the [README](README.md).

## Requirements

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

This builds `shared`, `server`, and `client`, then starts the server at **http://localhost:4000** and the management UI at **http://127.0.0.1:4001** (see [Download and run](README.md#download-and-run) for what it shows). Open http://localhost:4000 to create a draft and play; the host joins there like everyone else. Anyone else on the same network can join by opening `http://<your-computer's-LAN-IP>:4000` in their own browser.

### Development mode

For iterating on the code, run these in two separate terminals instead:

```bash
npm run dev:server   # server with auto-reload, port 4000
npm run dev:client   # Vite dev server with hot reload, port 5173
```

In dev mode, use the client on port 5173 (it's pre-configured via `client/.env.development` to talk to the server on 4000), and the management UI at http://localhost:5173/manage.html (it talks to the management server on 4001).

### The desktop app

The installed app is a [Tauri](https://tauri.app) window (`desktop/`) around the same server: it starts the server executable, shows its management UI (where the host starts the draft server, unless a draft is there to resume), stops the server when it closes and offers to install newer releases. Working on it needs [Rust](https://rustup.rs) and Tauri's [system prerequisites](https://tauri.app/start/prerequisites/) (Xcode Command Line Tools on macOS, WebView2 and the MSVC build tools on Windows, WebKitGTK on Linux).

```bash
npm run dev:desktop    # the app window, with the server and client in dev mode behind it (stop both by closing the window)
npm run build:desktop  # the installers for this computer, in desktop/src-tauri/target/release/bundle/
```

`build:desktop` also needs [cargo-about](https://github.com/EmbarkStudios/cargo-about), which lists the Rust crates' licenses: `cargo install --locked --features cli cargo-about@0.9.2`.

`dev:desktop` runs `dev:server` and `dev:client` itself, so don't run them alongside it.

### Configuration

The server reads the settings listed under [Configuration](README.md#configuration) in the README. From source, they come from `server/.env` for `npm start` and `npm run dev:server` (create it yourself; it isn't in the repository). A real environment variable takes precedence over the same setting in `.env`.

One more setting only matters when running from source:

- `MANAGEMENT_PORT` — defaults to `4001`. The management UI listens on this port on `127.0.0.1` only, so other computers can't open it. `0` picks any free port, which is what the desktop app uses.

To reset every draft, stop the server and delete `server/data/draft-session.json`. A single stuck draft can be cancelled in the management UI's **Drafts** panel.

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
npm run test:e2e                           # browser tests: players create and draft in real Chromium, and the management UI
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

GitHub Actions (`.github/workflows/ci.yml`) runs on every pull request into `main` or `dev`, and again on each push to them. It runs the typechecks, lint, builds, server tests and browser tests, and lints the desktop app's Rust code with clippy. It also builds and smoke-tests the installers for Linux, Windows, Apple Silicon and Intel Macs, without releasing them. A branch without a pull request isn't checked; run `npm run test:all` locally. Every merge into `main` publishes a release, so every pull request has to raise the version in the root `package.json`:

```bash
npm version patch --no-git-tag-version   # or minor / major; updates package.json and package-lock.json
```

Each run also checks that this version is higher than the latest GitHub Release, and the check fails if it isn't. Once a pull request with passing checks is merged, the workflow tests `main` again, builds and smoke-tests the server executable on Linux, Windows, Apple Silicon and Intel Macs, builds the desktop app's installers around it, and publishes them as Release `v<version>`, tagging the merged commit. Nothing is released if a test, a build or the version check fails. Versions on `main` must be plain `1.2.3`.

### Betas from `dev`

`dev` is the beta channel, for bigger changes that should reach testers before everyone. It works like `main`: branch off `dev`, open a pull request into `dev`, and CI runs the same checks. Each merge into `dev` publishes Release `v<X.Y.Z-beta.N>` as a **pre-release**. Betas build as a separate app, **Draft Simulator Beta**, with the extra config `desktop/src-tauri/tauri.beta.conf.json`: its own name, its own identifier (so its own app data folder and install) and its own update address.

Stable apps can't update to a beta: they read `releases/latest/download/latest.json`, and GitHub never counts a pre-release as the latest release. Installed betas read `releases/download/beta-channel/latest.json` instead. The `beta-channel` release holds only that file, and CI replaces it once each new beta is published. It must stay a pre-release: as the latest release, stable apps would install betas. CI refuses to update it otherwise.

Beta versions look like `1.2.3-beta.0`. Their `1.2.3` must be higher than the latest stable release, and each beta higher than the last beta:

```bash
npm version preminor --preid beta --no-git-tag-version     # first beta after a release: 0.3.16 → 0.4.0-beta.0
npm version prerelease --preid beta --no-git-tag-version   # every pull request into dev after that: → 0.4.0-beta.1
```

To release the betas to everyone, open a pull request from `dev` into `main` and set the version to the stable one in it (`npm version patch --no-git-tag-version` turns `0.4.0-beta.3` into `0.4.0`). It's squash-merged like every pull request into `main`, so `dev` doesn't contain that commit afterwards. Bring it back before the next beta, with a merge commit so that later merges into `main` don't conflict: on a branch off `dev`, `git merge origin/main`, start the next betas' version, then open a pull request into `dev` and merge it with **Create a merge commit**. Fixes that land on `main` in between go back to `dev` the same way.

### Required checks

GitHub refuses to merge a pull request until these checks pass, because the `protect` rule for `main` under **Settings → Rules** requires them: `test`, `desktop`, `audit`, `version`, `package (linux-x64)`, `package (windows-x64)`, `package (macos-arm64)` and `package (macos-x64)` from `ci.yml`, and `codeql (actions)`, `codeql (javascript-typescript)` and `codeql (rust)` from `codeql.yml`. A job renamed in a workflow must be renamed in that rule too, or nothing can be merged. A "code scanning results" rule also refuses a pull request that adds a CodeQL alert of high severity or above. The rule also makes every change to `main` go through a pull request, and stops `main` from being deleted or force-pushed. It allows only squash merges, so each pull request lands on `main` as one commit named after the pull request's title. Under **Settings → General → Pull Requests**, rebase merging is turned off, merge commits are allowed only for bringing `main` back into `dev` (the `main` rule still refuses them), and squash commits use the pull request's title and description as their message. Without the rule, a failing pull request could be merged, and the run on `main` would then fail without releasing anything. The `protect-dev` rule does the same for `dev`, with the same required checks, but allows merge commits as well as squash merges.

### Security checks

- **`audit`** (in `ci.yml`) fails on known vulnerabilities in the lockfiles: any advisory in what reaches hosts and players (`npm audit --omit=dev --audit-level=moderate`, and `cargo audit` for the desktop app's crates), and high or critical ones in the build and test tools (`npm audit --audit-level=high`). A newly published advisory makes it fail on every pull request until the dependency is updated. Run the same commands locally to see what it found.
- **`codeql (<language>)`** (in `codeql.yml`) analyzes the TypeScript, the Rust and the workflows. Its alerts are under **Security → Code scanning**. It also runs weekly, so new queries are checked against code that hasn't changed.
- **Dependabot** (`.github/dependabot.yml`) opens update pull requests into `dev` every week, for npm, cargo and the workflows' actions. Its pull requests don't bump the version, and their runs get no repository secrets, so the `version` and `package` checks fail on them. Before merging one, check out its branch, bump the version (`npm version prerelease --preid beta --no-git-tag-version`) and push: the run that starts is yours, with the secrets. Dependabot alerts are on; its automatic security updates are off, because they'd open pull requests straight into `main`.
- Every action in the workflows is pinned to a commit SHA, with its version in a comment, so a moved tag can't change what runs next to the signing key. Dependabot updates the pins.
- Secret scanning with push protection is on: GitHub refuses a push containing a recognized secret.

Installed apps update themselves from the releases (see [Updates](README.md#updates) in the README). The package jobs build signed update bundles next to the installers (`.app.tar.gz`, plus a `.sig` for each update file), using the extra config `desktop/src-tauri/tauri.updater.conf.json`. Before publishing, the workflow attaches `latest.json`, which lists them. The app reads it from `releases/latest/download/latest.json`. It installs an update only if its signature matches the public key in `tauri.conf.json`. The private key lives only in two repository secrets, which the package jobs need: `TAURI_SIGNING_PRIVATE_KEY` (the key file's contents) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. To create the key pair:

```bash
npx --workspace desktop tauri signer generate -w ~/.tauri/draft-simulator.key   # asks for a password
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/draft-simulator.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD                             # asks for the password
```

Then put the contents of `~/.tauri/draft-simulator.key.pub` into `plugins.updater.pubkey` in `tauri.conf.json`. Keep the private key and its password safe. Installed apps accept only updates signed with it, so losing it, or switching to a new key pair, means everyone has to install the next version by hand. A local `npm run build:desktop` doesn't build update bundles and doesn't need the key.

To build and smoke-test the installers without releasing them, run the workflow by hand: **Actions → CI → Run workflow**. The workflow never stores files as workflow artifacts, because artifact storage is shared by all your private repos and can fill up. The installers go straight onto the Release, whose files don't count toward that limit.

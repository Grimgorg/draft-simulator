# Draft Simulator

A self-hosted Magic: The Gathering cube draft simulator for a small group of friends. One person runs the server on their PC, imports a cube from [CubeCobra](https://cubecobra.com), and everyone else joins over the browser to draft together — packs, pass-direction rotation, live "who's still picking" status, and a decklist export at the end.

## Requirements

- **Node.js 20.11+** (LTS recommended; this project was built and tested on Node 24)
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

`npm install` installs dependencies for all three workspaces (`shared`, `server`, `client`). It may ask you to approve a couple of native install scripts (`better-sqlite3`, `esbuild`, `fsevents`) the first time — these are already recorded as approved in `package.json`, so a normal clone shouldn't prompt again.

The Scryfall card database (~38,000 cards, cached locally at `server/data/cards.sqlite3` so the app can resolve cube card lists and serve card images without hitting Scryfall on every request) no longer needs a manual import step: the server checks it on every startup and downloads it automatically if it's missing or older than 30 days, so `npm start` alone bootstraps everything on a fresh clone. Startup blocks briefly only the very first time (nothing works with zero cached cards); a routine refresh of an already-populated cache happens in the background so the server is usable immediately. Override the staleness threshold with `CARD_CACHE_MAX_AGE_DAYS` (e.g. `CARD_CACHE_MAX_AGE_DAYS=7 npm start`), or force a refresh manually any time with `npm run import-cards --workspace server`.

## Running it

### Quick start (recommended)

```bash
npm start
```

This builds `shared`, `server`, and `client`, then starts the server at **http://localhost:4000**. Open that URL — that's the host's screen. Anyone else on the same network can join by opening `http://<your-computer's-LAN-IP>:4000` in their own browser.

### Development mode

For iterating on the code, run these in two separate terminals instead:

```bash
npm run dev:server   # server with auto-reload, port 4000
npm run dev:client   # Vite dev server with hot reload, port 5173
```

In dev mode, use the client on port 5173 (it's pre-configured via `client/.env.development` to talk to the server on 4000).

### Configuration

Environment variables the server reads at startup:

- `PORT` — defaults to `4000`.
- `CARD_CACHE_MAX_AGE_DAYS` — defaults to `30`; see the card database note above.
- `LOBBY_PASSWORD` — unset by default (no password required). If set, everyone must enter this password before they can connect at all — useful if you're exposing the server beyond your LAN (e.g. port-forwarding it to the internet for a remote draft). It's a single shared password for the whole server, not per-draft.

## How a draft works

1. The host opens the app, pastes a CubeCobra cube URL (or ID), sets the number of players / packs / cards per pack, and clicks **Create draft**.
2. Everyone else opens the same URL and joins with their name.
3. Once every seat is filled, the host clicks **Start draft**.
4. Everyone picks from their own pack each round; packs rotate automatically once everyone's picked. There's no time limit.
5. If someone's browser refreshes or their connection drops, reopening the same URL in the same browser resumes them automatically. If it's a new browser or device (or the old one lost its storage), open the URL and pick your name from the "Rejoin as..." list — this works at any point in the draft, not just the lobby.
6. Once the last pack is empty, everyone gets their own pool and can copy or download their picks as a decklist.

## Project structure

- `shared/` — TypeScript types and Socket.IO event contracts shared between client and server
- `server/` — Express + Socket.IO backend: Scryfall card cache, CubeCobra importer, draft engine, session/reconnect handling
- `client/` — React frontend
- `e2e/` — Playwright browser tests that play a draft as host and guest

## Tests

```bash
npm test                                   # server unit and socket integration tests
npx --workspace e2e playwright install chromium   # once, before the first browser test run
npm run test:e2e                           # browser tests: a host and a guest draft in real Chromium
```

Most tests are network-free. Three socket integration tests need internet access (they import a real CubeCobra cube), and both those and the browser tests need the local card cache from the setup step above.

## Known limitations

- One draft at a time per server instance — the host has to finish (or the host can start a fresh one from the results screen) before a new one can begin.
- Identity is trust-based, not authenticated: the "Rejoin as..." list shows every player's name and lets anyone pick any seat, since this is meant for a small group of friends who trust each other, not a public server. Picking a name that's still connected elsewhere signs that other session out. If a draft ever gets stuck beyond that, stop the server and delete `server/data/draft-session.json` to reset it. If you're exposing the server beyond your LAN, set `LOBBY_PASSWORD` (see Configuration above) so a stranger who finds the URL can't connect at all.

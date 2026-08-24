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
npm run import-cards --workspace server
```

- `npm install` installs dependencies for all three workspaces (`shared`, `server`, `client`). It may ask you to approve a couple of native install scripts (`better-sqlite3`, `esbuild`, `fsevents`) the first time — these are already recorded as approved in `package.json`, so a normal clone shouldn't prompt again.
- `npm run import-cards --workspace server` downloads Scryfall's card database (~38,000 cards) into a local SQLite cache at `server/data/cards.sqlite3`. This is what lets the app resolve cube card lists and serve card images without hitting Scryfall on every request. Re-run it occasionally to pick up new sets — it's safe to run again any time.

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

## How a draft works

1. The host opens the app, pastes a CubeCobra cube URL (or ID), sets the number of players / packs / cards per pack, and clicks **Create draft**.
2. Everyone else opens the same URL and joins with their name.
3. Once every seat is filled, the host clicks **Start draft**.
4. Everyone picks from their own pack each round; packs rotate automatically once everyone's picked. There's no time limit.
5. If someone's browser refreshes or their connection drops, reopening the same URL in the same browser resumes them automatically — no progress lost.
6. Once the last pack is empty, everyone gets their own pool and can copy or download their picks as a decklist.

## Project structure

- `shared/` — TypeScript types and Socket.IO event contracts shared between client and server
- `server/` — Express + Socket.IO backend: Scryfall card cache, CubeCobra importer, draft engine, session/reconnect handling
- `client/` — React frontend

## Tests

```bash
npm test --workspace server
```

Most tests are network-free. One integration test drives the real Socket.IO server end-to-end and needs internet access (it imports a real CubeCobra cube) plus the local card cache from the setup step above.

## Known limitations

- One draft at a time per server instance — the host has to finish (or the host can start a fresh one from the results screen) before a new one can begin.
- Reconnect is tied to the browser: it resumes you automatically in the same browser you joined from, but not from a different device or after clearing site data. If a draft ever gets stuck because everyone lost their browser storage, stop the server and delete `server/data/draft-session.json` to reset it.

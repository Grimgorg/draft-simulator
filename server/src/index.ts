// Must stay the first import: the management UI's log viewer shows what's
// logged from here on, including what loadEnvFile logs while it loads.
import "./management/captureConsole.js";
// Must come before every other module: it loads the executable's .env before
// any of them reads its settings.
import "./packaged/loadEnvFile.js";
import { getDb } from "./db/database.js";
import { countCards } from "./cardData/cardRepository.js";
import { refreshCardDatabaseIfStale } from "./cardData/cardDatabaseFreshness.js";
import { ensureImageDir } from "./images/imageCache.js";
import { shouldStartDraftServerAtLaunch } from "./management/launchStart.js";
import { startManagementServer } from "./management/managementServer.js";
import { readStartupSettings } from "./management/settingsFile.js";
import { listDrafts } from "./session/lobbyManager.js";
import { exitAfterFatalError, resolveEnvFilePath } from "./packaged/seaRuntime.js";

const MANAGEMENT_PORT = Number(process.env.MANAGEMENT_PORT ?? 4001);
/** Run by the desktop app rather than from source. */
const MANAGED = process.env.DRAFT_SIMULATOR_MANAGED === "1";

// Node's default for an unhandled rejection is to kill the process, which
// for a host running a live draft means everyone is stuck until a restart.
// Every known async path handles its own errors; this is the backstop so a
// missed one gets logged instead of taking the draft down.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection (server kept running):", reason);
});

// The desktop app runs the server as its child and stops it when it quits.
// If the app goes away without doing that (a crash, a force quit), its end
// of this pipe closes; exiting then frees the ports instead of leaving an
// invisible server running that the next start can't get past.
if (MANAGED) {
  process.stdin.on("end", () => process.exit(0));
  process.stdin.resume();
}

// Startup runs in main() rather than at the top level because the packaged
// executable is a CommonJS bundle, which can't use top-level await.
async function main(): Promise<void> {
  getDb();
  ensureImageDir();

  let cardDatabaseRefreshing = false;
  // Up before the card database check, so the host can watch a first-start
  // download in the management UI instead of a window that seems stuck.
  const management = await startManagementServer({
    port: MANAGEMENT_PORT,
    envFilePath: resolveEnvFilePath(),
    savedSettings: readStartupSettings(),
    isCardDatabaseRefreshing: () => cardDatabaseRefreshing,
  });
  // The desktop app reads this line to find the management UI.
  console.log(`Management UI: ${management.url}`);

  function refreshCardDatabase(): Promise<void> {
    cardDatabaseRefreshing = true;
    management.broadcastState();
    return refreshCardDatabaseIfStale().finally(() => {
      cardDatabaseRefreshing = false;
      management.broadcastState();
    });
  }

  // An empty cache means the app can't resolve any cube at all, so wait for
  // the first import before letting players in. Otherwise — just stale —
  // refresh in the background so the host isn't stuck waiting right before
  // a draft.
  if (countCards() === 0) {
    await refreshCardDatabase();
  } else {
    refreshCardDatabase();
  }

  if (!shouldStartDraftServerAtLaunch(MANAGED, listDrafts().map((entry) => entry.session.status))) {
    console.log("Draft server not started: start it from the management UI.");
    return;
  }
  // A failed start (a busy port) is logged and shown in the management UI,
  // where the host can choose another port, so it doesn't end the process.
  await management.startDraftServer();
}

main().catch((err: unknown) => {
  console.error("Draft Simulator failed to start:", err);
  exitAfterFatalError();
});

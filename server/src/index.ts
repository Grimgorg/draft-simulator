// Must stay the first import: it loads the executable's .env before any
// other module reads its settings.
import "./packaged/loadEnvFile.js";
import { getDb } from "./db/database.js";
import { countCards } from "./cardData/cardRepository.js";
import { refreshCardDatabaseIfStale } from "./cardData/cardDatabaseFreshness.js";
import { ensureImageDir } from "./images/imageCache.js";
import { createDraftHttpServer } from "./management/draftServer.js";
import { exitAfterFatalError, resolveEnvFilePath } from "./packaged/seaRuntime.js";
import { buildPortInUseMessage, buildStartupBanner } from "./startupBanner.js";

const PORT = Number(process.env.PORT ?? 4000);

// Node's default for an unhandled rejection is to kill the process, which
// for a host running a live draft means everyone is stuck until a restart.
// Every known async path handles its own errors; this is the backstop so a
// missed one gets logged instead of taking the draft down.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection (server kept running):", reason);
});

// Startup runs in main() rather than at the top level because the packaged
// executable is a CommonJS bundle, which can't use top-level await.
async function main(): Promise<void> {
  getDb();
  ensureImageDir();

  // An empty cache means the app can't resolve any cube at all, so block
  // startup on the first import. Otherwise — just stale — refresh in the
  // background so the host isn't stuck waiting right before a draft.
  if (countCards() === 0) {
    await refreshCardDatabaseIfStale();
  } else {
    refreshCardDatabaseIfStale();
  }

  const { httpServer } = createDraftHttpServer(process.env.LOBBY_PASSWORD);

  // Without a listener, a busy port is an uncaught error and a bare stack
  // trace — and the host's first guess should be a second copy still running.
  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(buildPortInUseMessage(PORT, resolveEnvFilePath()));
    } else {
      console.error("Draft Simulator server error:", err);
    }
    exitAfterFatalError();
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(
      buildStartupBanner({ port: PORT, lobbyPassword: process.env.LOBBY_PASSWORD, envFilePath: resolveEnvFilePath() }),
    );
  });
}

main().catch((err: unknown) => {
  console.error("Draft Simulator failed to start:", err);
  exitAfterFatalError();
});

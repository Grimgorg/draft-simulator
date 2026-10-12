import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../db/database.js";

// Crash-safe JSON snapshot of the draft session on disk, used to resume a
// draft after a server restart. Knows nothing about the state's shape —
// lobbyManager owns that.

/** Errors Windows raises while another process (antivirus, the search
 * indexer, a backup/sync tool) briefly holds the snapshot open. */
const TRANSIENT_RENAME_ERRORS = new Set(["EPERM", "EBUSY", "EACCES"]);
/** Total time to keep retrying a transiently blocked rename before giving up on this write. */
const RENAME_RETRY_BUDGET_MS = 250;
/** How soon to try again in the background after a write gave up. */
const DEFERRED_PERSIST_DELAY_MS = 1000;

/** The most recent state handed to saveSnapshot — what a deferred retry writes. */
let latestState: unknown;
let deferredPersist: NodeJS.Timeout | undefined;

function snapshotPath(): string {
  return process.env.DRAFT_SNAPSHOT_PATH ?? path.join(DATA_DIR, "draft-session.json");
}

/** Returns the saved snapshot's parsed JSON, or undefined when there is none or it can't be read. */
export function loadSnapshot(): unknown {
  const file = snapshotPath();
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch (err) {
    // Don't just fall back to an empty draft and let the next save
    // overwrite the only copy of it — preserve the unreadable file so
    // there's something to recover from, and make the loss loud rather
    // than a quiet fresh start.
    const backupFile = `${file}.corrupt.${Date.now()}`;
    console.error(
      `Failed to load draft session snapshot; starting fresh. The unreadable file was preserved at ${backupFile} for recovery.`,
      err
    );
    try {
      fs.renameSync(file, backupFile);
    } catch (renameErr) {
      console.error(`Could not preserve the corrupt snapshot at ${file}:`, renameErr);
    }
  }
  return undefined;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** renameSync, retried with backoff while the error looks like a transient Windows file lock. */
function renameWithRetry(from: string, to: string): void {
  const deadline = Date.now() + RENAME_RETRY_BUDGET_MS;
  let delay = 2;
  for (;;) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (!code || !TRANSIENT_RENAME_ERRORS.has(code) || Date.now() >= deadline) throw err;
      sleepSync(delay);
      delay = Math.min(delay * 2, 50);
    }
  }
}

/**
 * Writes via a temp file + rename rather than straight to `file`. A plain
 * `writeFileSync` on the live path leaves a truncated, unparseable file if
 * the process dies mid-write (crash, OOM kill, power loss); `loadSnapshot`
 * would then fail and the server would start with an empty session,
 * discarding the whole draft. `rename` is atomic on POSIX filesystems, so
 * `file` always holds either the fully-old or fully-new snapshot, never a
 * partial one.
 */
function writeSnapshot(): void {
  const file = snapshotPath();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmpFile = path.join(dir, `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    const fd = fs.openSync(tmpFile, "w");
    try {
      fs.writeSync(fd, JSON.stringify(latestState, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    renameWithRetry(tmpFile, file);
  } catch (err) {
    fs.rmSync(tmpFile, { force: true });
    throw err;
  }
}

/**
 * Saves `state` to disk for restart recovery. Never throws: the in-memory
 * state is the live source of truth, and callers have usually already
 * mutated it (e.g. a pick that advanced the round) by the time this runs.
 * Throwing here used to abort the socket handler before it broadcast that
 * change, leaving every client waiting on a round the server had already
 * moved past — the draft stayed stuck until a restart. On Windows this
 * happened whenever antivirus or the search indexer briefly held the
 * snapshot open. A failed write is retried in the background instead.
 */
export function saveSnapshot(state: unknown): void {
  latestState = state;
  // A background retry is already scheduled and will write whatever the
  // latest state is by then, so don't block this action on retrying
  // synchronously against a disk that just refused a write.
  if (deferredPersist) return;
  trySaveSnapshot();
}

function trySaveSnapshot(): void {
  try {
    writeSnapshot();
  } catch (err) {
    console.error(
      `Could not save the draft snapshot; the draft continues and saving will be retried in ${DEFERRED_PERSIST_DELAY_MS}ms:`,
      err
    );
    deferredPersist = setTimeout(() => {
      deferredPersist = undefined;
      trySaveSnapshot();
    }, DEFERRED_PERSIST_DELAY_MS);
    deferredPersist.unref();
  }
}

/** Test-only: points the store at an isolated snapshot file and cancels any pending retry. */
export function resetSnapshotStoreForTests(isolatedSnapshotPath: string): void {
  process.env.DRAFT_SNAPSHOT_PATH = isolatedSnapshotPath;
  clearTimeout(deferredPersist);
  deferredPersist = undefined;
}

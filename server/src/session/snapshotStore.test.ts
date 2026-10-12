import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSnapshot, resetSnapshotStoreForTests, saveSnapshot } from "./snapshotStore.js";

function freshSnapshotDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "draft-simulator-snapshot-"));
}

test("loads nothing when no snapshot has been saved yet", (t) => {
  const dir = freshSnapshotDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  resetSnapshotStoreForTests(path.join(dir, "draft-session.json"));

  assert.equal(loadSnapshot(), undefined);
});

test("loads back exactly what was saved, creating a missing data directory", (t) => {
  const dir = freshSnapshotDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "nested", "draft-session.json");
  resetSnapshotStoreForTests(file);
  const state = { session: { id: "s1", players: [{ id: "A", connected: true }] }, cardPool: [{ scryfallId: "c1" }] };

  saveSnapshot(state);

  assert.deepEqual(loadSnapshot(), state);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["draft-session.json"], "no temp files left behind");
});

test("a later save replaces the earlier snapshot", (t) => {
  const dir = freshSnapshotDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  resetSnapshotStoreForTests(path.join(dir, "draft-session.json"));

  saveSnapshot({ pick: 1 });
  saveSnapshot({ pick: 2 });

  assert.deepEqual(loadSnapshot(), { pick: 2 });
});

test("an unreadable snapshot is set aside for recovery instead of being overwritten by the next save", (t) => {
  const dir = freshSnapshotDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "draft-session.json");
  resetSnapshotStoreForTests(file);
  const errorLog = t.mock.method(console, "error", () => {});
  // What a crash mid-write used to leave behind.
  fs.writeFileSync(file, '{"session": {"status": "drafti');

  assert.equal(loadSnapshot(), undefined);
  assert.ok(errorLog.mock.callCount() > 0, "the lost draft is reported, not silently replaced");

  saveSnapshot({ fresh: true });

  const backups = fs.readdirSync(dir).filter((f) => f.startsWith("draft-session.json.corrupt."));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, backups[0]!), "utf8"), '{"session": {"status": "drafti');
  assert.deepEqual(loadSnapshot(), { fresh: true });
});

import assert from "node:assert/strict";
import test from "node:test";
import { shouldStartDraftServerAtLaunch } from "./launchStart.js";

test("the desktop app leaves the draft server stopped when there's no draft or it's complete", () => {
  assert.equal(shouldStartDraftServerAtLaunch(true, undefined), false);
  assert.equal(shouldStartDraftServerAtLaunch(true, "complete"), false);
});

test("the desktop app starts the draft server so players can get back into an open or running draft", () => {
  assert.equal(shouldStartDraftServerAtLaunch(true, "lobby"), true);
  assert.equal(shouldStartDraftServerAtLaunch(true, "drafting"), true);
});

test("run from source, the draft server always starts", () => {
  for (const status of [undefined, "lobby", "drafting", "complete"] as const) {
    assert.equal(shouldStartDraftServerAtLaunch(false, status), true);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { runOpenCommand } from "./openInBrowser.js";

test("a missing opener is reported instead of crashing the server", async () => {
  const result = await runOpenCommand({ command: "draft-simulator-no-such-opener", args: ["http://localhost:4000"] });
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", /^Couldn't open the browser: .*ENOENT/);
});

test("an opener that starts is reported as opened", async () => {
  assert.deepEqual(await runOpenCommand({ command: process.execPath, args: ["-e", ""] }), { ok: true });
});

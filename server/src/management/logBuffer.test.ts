import assert from "node:assert/strict";
import test from "node:test";
import { MAX_LOG_ENTRIES, captureConsole, clearLogsForTests, getLogHistory, onLog, recordLog } from "./logBuffer.js";

function fakeConsole() {
  const printed: string[] = [];
  const target = {
    log: (...args: unknown[]) => printed.push(`log ${args.join(" ")}`),
    info: (...args: unknown[]) => printed.push(`info ${args.join(" ")}`),
    warn: (...args: unknown[]) => printed.push(`warn ${args.join(" ")}`),
    error: (...args: unknown[]) => printed.push(`error ${args.join(" ")}`),
  };
  return { target, printed };
}

test("captured console output is still printed and is recorded with its level", () => {
  clearLogsForTests();
  const { target, printed } = fakeConsole();
  captureConsole(target);

  target.log("Client connected: %s", "abc");
  target.info("info line");
  target.warn("careful");
  target.error("broken");

  assert.deepEqual(printed, ["log Client connected: %s abc", "info info line", "warn careful", "error broken"]);
  assert.deepEqual(
    getLogHistory().map(({ level, message }) => ({ level, message })),
    [
      { level: "info", message: "Client connected: abc" },
      { level: "info", message: "info line" },
      { level: "warn", message: "careful" },
      { level: "error", message: "broken" },
    ],
  );
});

test("a logged error keeps its stack trace", () => {
  clearLogsForTests();
  const { target } = fakeConsole();
  captureConsole(target);

  target.error("Card import failed:", new Error("network down"));

  const [entry] = getLogHistory();
  assert.match(entry.message, /^Card import failed: Error: network down\n\s+at /);
});

test("only the most recent entries are kept, oldest first, with increasing ids", () => {
  clearLogsForTests();
  for (let i = 1; i <= MAX_LOG_ENTRIES + 5; i++) recordLog("info", `line ${i}`);

  const history = getLogHistory();
  assert.equal(history.length, MAX_LOG_ENTRIES);
  assert.equal(history[0].message, "line 6");
  assert.equal(history.at(-1)?.message, `line ${MAX_LOG_ENTRIES + 5}`);
  assert.ok(history.every((entry, i) => i === 0 || entry.id === history[i - 1].id + 1));
});

test("listeners get every new entry until they stop listening", () => {
  clearLogsForTests();
  const received: string[] = [];
  const stop = onLog((entry) => received.push(entry.message));

  recordLog("info", "first");
  stop();
  recordLog("info", "second");

  assert.deepEqual(received, ["first"]);
});

test("a failing listener doesn't break logging or the other listeners", () => {
  clearLogsForTests();
  const { target, printed } = fakeConsole();
  captureConsole(target);
  const received: string[] = [];
  const stopFailing = onLog(() => {
    throw new Error("listener broke");
  });
  const stopWorking = onLog((entry) => received.push(entry.message));

  try {
    assert.doesNotThrow(() => target.log("still works"));
  } finally {
    stopFailing();
    stopWorking();
  }

  assert.deepEqual(received, ["still works"]);
  assert.ok(printed.some((line) => line.startsWith("error A log listener failed:")));
});

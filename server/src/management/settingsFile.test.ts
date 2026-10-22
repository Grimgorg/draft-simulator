import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseEnv } from "node:util";
import { buildExampleEnvFile } from "../packaged/exampleEnvFile.js";
import { readStartupSettings, setEnvValue, validateSettings, writeSettings } from "./settingsFile.js";

function tmpEnvPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "draft-simulator-settings-")), ".env");
}

test("startup settings come from the environment, with port 4000 and no password by default", () => {
  assert.deepEqual(readStartupSettings({}), { port: 4000, lobbyPassword: "" });
  assert.deepEqual(readStartupSettings({ PORT: "5000", LOBBY_PASSWORD: "hunter2" }), {
    port: 5000,
    lobbyPassword: "hunter2",
  });
});

test("a port outside 1-65535 or not a whole number is rejected", () => {
  for (const port of [0, 65536, 4000.5, Number.NaN]) {
    assert.match(validateSettings({ port, lobbyPassword: "" }) ?? "", /port must be a whole number/);
  }
  assert.equal(validateSettings({ port: 1, lobbyPassword: "" }), undefined);
  assert.equal(validateSettings({ port: 65535, lobbyPassword: "" }), undefined);
});

test("the management UI's own port is refused for players", () => {
  assert.match(validateSettings({ port: 4001, lobbyPassword: "" }, 4001) ?? "", /management UI's own port/);
  assert.equal(validateSettings({ port: 4000, lobbyPassword: "" }, 4001), undefined);
});

test("a password that can't be written to .env is rejected", () => {
  for (const lobbyPassword of ['say "hi"', "back\\slash", "two\nlines"]) {
    assert.match(validateSettings({ port: 4000, lobbyPassword }) ?? "", /can't contain/);
  }
  assert.equal(validateSettings({ port: 4000, lobbyPassword: "pa ss#word!" }), undefined);
});

test("a commented-out setting is uncommented with the new value", () => {
  const text = setEnvValue(buildExampleEnvFile(), "PORT", "5000");

  assert.match(text, /^PORT=5000$/m);
  assert.doesNotMatch(text, /# PORT=/);
  assert.deepEqual(parseEnv(text), { PORT: "5000" });
});

test("an active setting is replaced, and later duplicates are removed", () => {
  const text = setEnvValue("PORT=4000\nOTHER=1\nPORT=4100\n", "PORT", "5000");

  assert.equal(text, "PORT=5000\nOTHER=1\n");
});

test("a setting the file doesn't mention is appended, keeping the final newline", () => {
  assert.equal(setEnvValue("OTHER=1\n", "PORT", "5000"), "OTHER=1\nPORT=5000\n");
});

test("a null value comments the setting out without keeping the old value", () => {
  assert.equal(setEnvValue("LOBBY_PASSWORD=hunter2\n", "LOBBY_PASSWORD", null), "# LOBBY_PASSWORD=\n");
  assert.equal(setEnvValue("OTHER=1\n", "LOBBY_PASSWORD", null), "OTHER=1\n");
});

test("Windows line endings are kept", () => {
  assert.equal(setEnvValue("# PORT=4000\r\nOTHER=1\r\n", "PORT", "5000"), "PORT=5000\r\nOTHER=1\r\n");
});

test("saved settings read back as saved, and the file's other lines are kept", () => {
  const envFile = tmpEnvPath();
  fs.writeFileSync(envFile, "# My notes\nCARD_CACHE_MAX_AGE_DAYS=7\nPORT=4000\n");

  writeSettings(envFile, { port: 5123, lobbyPassword: "pa ss#word" });

  const text = fs.readFileSync(envFile, "utf8");
  assert.match(text, /^# My notes$/m);
  assert.deepEqual(parseEnv(text), { CARD_CACHE_MAX_AGE_DAYS: "7", PORT: "5123", LOBBY_PASSWORD: "pa ss#word" });
});

test("saving an empty password removes it", () => {
  const envFile = tmpEnvPath();
  fs.writeFileSync(envFile, 'LOBBY_PASSWORD="hunter2"\n');

  writeSettings(envFile, { port: 4000, lobbyPassword: "" });

  assert.deepEqual(parseEnv(fs.readFileSync(envFile, "utf8")), { PORT: "4000" });
  assert.doesNotMatch(fs.readFileSync(envFile, "utf8"), /hunter2/);
});

test("saving without a settings file creates one from the example", () => {
  const envFile = tmpEnvPath();

  writeSettings(envFile, { port: 5000, lobbyPassword: "hunter2" });

  const text = fs.readFileSync(envFile, "utf8");
  assert.match(text, /^# Draft Simulator settings\./);
  assert.deepEqual(parseEnv(text), { PORT: "5000", LOBBY_PASSWORD: "hunter2" });
});

test("a settings file that can't be written is reported, not ignored", () => {
  const envFile = path.join(tmpEnvPath(), "missing-dir", ".env");

  assert.throws(() => writeSettings(envFile, { port: 4000, lobbyPassword: "" }), { code: "ENOENT" });
});

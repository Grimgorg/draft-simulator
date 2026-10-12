import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { buildExampleEnvFile, createExampleEnvFileIfMissing } from "./exampleEnvFile.js";

function tmpEnvPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "draft-simulator-env-")), ".env");
}

test("the example settings file changes nothing until the host edits it", () => {
  assert.deepEqual(parseEnv(buildExampleEnvFile()), {});
});

test("uncommenting a line in the example settings file sets that value", () => {
  const edited = buildExampleEnvFile().replace("# PORT=4000", "PORT=5000").replace("# LOBBY_PASSWORD=", "LOBBY_PASSWORD=");

  assert.deepEqual(parseEnv(edited), { PORT: "5000", LOBBY_PASSWORD: "choose-a-password" });
});

test("a missing settings file is created with the example contents", () => {
  const envFile = tmpEnvPath();

  assert.equal(createExampleEnvFileIfMissing(envFile), true);
  assert.equal(fs.readFileSync(envFile, "utf8"), buildExampleEnvFile());
});

test("an existing settings file is never overwritten", () => {
  const envFile = tmpEnvPath();
  fs.writeFileSync(envFile, "LOBBY_PASSWORD=hunter2\n");

  assert.equal(createExampleEnvFileIfMissing(envFile), false);
  assert.equal(fs.readFileSync(envFile, "utf8"), "LOBBY_PASSWORD=hunter2\n");
});

test("a settings file that can't be written is reported, not ignored", () => {
  const envFile = path.join(tmpEnvPath(), "missing-dir", ".env");

  assert.throws(() => createExampleEnvFileIfMissing(envFile), { code: "ENOENT" });
});

/**
 * Writes the THIRD_PARTY_NOTICES.txt the desktop app ships: the server
 * executable's notices (release/THIRD_PARTY_NOTICES.txt, written by
 * build:exe) followed by the licenses of the Rust crates compiled into the
 * app, which cargo-about collects. Most of those licenses (MIT, Apache-2.0,
 * BSD) require their notice to travel with every copy.
 *
 * Run with: npm run notices --workspace desktop   (after npm run build:exe)
 * Needs cargo-about: cargo install --locked --features cli cargo-about@0.9.2
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DESKTOP_DIR = path.join(import.meta.dirname, "..");
const TAURI_DIR = path.join(DESKTOP_DIR, "src-tauri");
const SERVER_NOTICES = path.join(DESKTOP_DIR, "../release/THIRD_PARTY_NOTICES.txt");
// Bundled into the app by tauri.bundle.conf.json.
const APP_NOTICES = path.join(TAURI_DIR, "THIRD_PARTY_NOTICES.txt");

if (!fs.existsSync(SERVER_NOTICES)) {
  throw new Error(`${SERVER_NOTICES} is missing. Run npm run build:exe first.`);
}

// Written to a file rather than read from stdout: on Windows, cargo-about
// refuses to write to a pipe it suspects is PowerShell's, which would mangle
// the encoding, and CI's Windows runner made it suspect that.
const rustNoticesFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "draft-simulator-notices-")), "rust.txt");
try {
  execFileSync(
    "cargo",
    [
      "about",
      "generate",
      "--fail",
      "--locked",
      "--config",
      "about.toml",
      "--manifest-path",
      "Cargo.toml",
      "--output-file",
      rustNoticesFile,
      "about.hbs",
    ],
    { cwd: TAURI_DIR, stdio: "inherit" },
  );
} catch (err) {
  throw new Error(
    "cargo about failed (its output is above). If it isn't installed: cargo install --locked --features cli cargo-about@0.9.2",
    { cause: err },
  );
}

const rustNotices = fs.readFileSync(rustNoticesFile, "utf8");
fs.rmSync(path.dirname(rustNoticesFile), { recursive: true, force: true });

// Written fresh from both parts every time, so running it twice doesn't list anything twice.
fs.writeFileSync(APP_NOTICES, `${fs.readFileSync(SERVER_NOTICES, "utf8").trimEnd()}\n\n${rustNotices.trimEnd()}\n`);
console.log(`Wrote ${APP_NOTICES}`);

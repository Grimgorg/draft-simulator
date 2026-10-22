/**
 * Builds the server, with the client and SQLite's native addon embedded, into
 * one executable for the platform this runs on, using Node's single
 * executable application support. The executable is a copy of the Node
 * binary running this script, so build each platform on that platform.
 *
 * Run with: npm run build:exe   (writes release/draft-simulator-<os>-<arch>[.exe])
 *
 * It's also copied into the desktop app as its sidecar, which
 * `npm run build:desktop` bundles.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";
import { CLIENT_ASSET_PREFIX } from "../src/packaged/embeddedClient.js";
import { SQLITE_ADDON_ASSET } from "../src/packaged/seaRuntime.js";
import { buildThirdPartyNotices, collectDependencyDirs, packageDirOf, readPackageNotice } from "./thirdPartyNotices.js";

const SERVER_DIR = path.join(import.meta.dirname, "..");
const ROOT = path.join(SERVER_DIR, "..");
const CLIENT_DIST = path.join(ROOT, "client/dist");
const BUILD_DIR = path.join(SERVER_DIR, "build/sea");
const RELEASE_DIR = path.join(ROOT, "release");
const SIDECAR_DIR = path.join(ROOT, "desktop/src-tauri/binaries");

/** Node's fixed marker that tells the binary a SEA blob has been injected. */
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

const require = createRequire(import.meta.url);
const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";

function run(command: string, args: string[]): void {
  execFileSync(command, args, { cwd: ROOT, stdio: "inherit" });
}

function platformName(): string {
  if (isWindows) return "windows";
  if (isMac) return "macos";
  return process.platform;
}

/**
 * The Rust target triple of this platform: Tauri looks for a sidecar named
 * <name>-<triple>. Mapped here rather than asked of rustc, so building the
 * executable alone doesn't need Rust.
 */
function rustTargetTriple(): string {
  const triples: Record<string, string> = {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "linux-x64": "x86_64-unknown-linux-gnu",
    "linux-arm64": "aarch64-unknown-linux-gnu",
    "win32-x64": "x86_64-pc-windows-msvc",
    "win32-arm64": "aarch64-pc-windows-msvc",
  };
  const triple = triples[`${process.platform}-${process.arch}`];
  if (!triple) throw new Error(`No Rust target triple known for ${process.platform}-${process.arch}.`);
  return triple;
}

function listFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

// npm is a .cmd script on Windows, which only starts through a shell.
for (const workspace of ["shared", "client"]) {
  execFileSync("npm", ["run", "build", "--workspace", workspace], { cwd: ROOT, stdio: "inherit", shell: isWindows });
}

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
fs.mkdirSync(BUILD_DIR, { recursive: true });

// A SEA runs one CommonJS script, so everything goes into a single bundle.
// ws tries its optional native speedups in a try/catch and falls back
// without them, so they stay out. import.meta is empty in CommonJS; the
// server only reads it on paths that never run packaged (see seaRuntime.ts),
// and the smoke test catches one on the startup path.
const bundlePath = path.join(BUILD_DIR, "server.cjs");
const { metafile } = await build({
  entryPoints: [path.join(SERVER_DIR, "src/index.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  outfile: bundlePath,
  external: ["bufferutil", "utf-8-validate"],
  logLevel: "warning",
  logOverride: { "empty-import-meta": "silent" },
  // Lists the bundled files, so the notices name exactly the packages inside.
  metafile: true,
});

const assets: Record<string, string> = {
  [SQLITE_ADDON_ASSET]: path.join(path.dirname(require.resolve("better-sqlite3/package.json")), "build/Release/better_sqlite3.node"),
};
for (const file of listFiles(CLIENT_DIST)) {
  // Asset keys use forward slashes on every platform, matching request paths.
  assets[CLIENT_ASSET_PREFIX + path.relative(CLIENT_DIST, file).split(path.sep).join("/")] = file;
}
for (const file of Object.values(assets)) {
  if (!fs.existsSync(file)) throw new Error(`Missing file to embed: ${file}`);
}

const blobPath = path.join(BUILD_DIR, "sea-prep.blob");
const seaConfigPath = path.join(BUILD_DIR, "sea-config.json");
fs.writeFileSync(
  seaConfigPath,
  JSON.stringify({ main: bundlePath, output: blobPath, disableExperimentalSEAWarning: true, assets }, null, 2),
);
run(process.execPath, ["--experimental-sea-config", seaConfigPath]);

fs.mkdirSync(RELEASE_DIR, { recursive: true });
const executablePath = path.join(
  RELEASE_DIR,
  `draft-simulator-${platformName()}-${process.arch}${isWindows ? ".exe" : ""}`,
);
fs.rmSync(executablePath, { force: true });
fs.copyFileSync(process.execPath, executablePath);
fs.chmodSync(executablePath, 0o755);

// macOS refuses to run a signed binary whose contents changed, so drop the
// signature before injecting and sign it again (ad hoc) afterwards.
if (isMac) run("codesign", ["--remove-signature", executablePath]);
const postjectArgs = [executablePath, "NODE_SEA_BLOB", blobPath, "--sentinel-fuse", SEA_FUSE];
if (isMac) postjectArgs.push("--macho-segment-name", "NODE_SEA");
run(process.execPath, [require.resolve("postject/dist/cli.js"), ...postjectArgs]);
if (isMac) run("codesign", ["--sign", "-", executablePath]);

console.log(`Built ${executablePath}`);

fs.mkdirSync(SIDECAR_DIR, { recursive: true });
const sidecarPath = path.join(SIDECAR_DIR, `draft-simulator-server-${rustTargetTriple()}${isWindows ? ".exe" : ""}`);
fs.copyFileSync(executablePath, sidecarPath);
console.log(`Copied it to ${sidecarPath} for the desktop app`);

/**
 * Node's own LICENSE, which also covers the libraries built into it (V8,
 * OpenSSL, ICU, ...). Official Node downloads keep it next to the binary
 * (Windows) or one folder up (macOS, Linux); the Windows installer doesn't
 * install it, so fall back to the copy for this exact version on GitHub.
 */
async function readNodeLicense(): Promise<string> {
  const nodeDir = path.dirname(process.execPath);
  for (const candidate of [path.join(nodeDir, "LICENSE"), path.join(nodeDir, "..", "LICENSE")]) {
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, "utf8");
  }
  const url = `https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download Node's license from ${url}: ${res.status} ${res.statusText}`);
  return res.text();
}

// esbuild reports bundled files relative to the folder it ran in.
const serverPackageDirs = Object.keys(metafile.inputs)
  .map((input) => packageDirOf(path.resolve(input)))
  .filter((dir): dir is string => dir !== undefined);
const clientPackage = JSON.parse(fs.readFileSync(path.join(ROOT, "client/package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};
const clientPackageDirs = collectDependencyDirs(
  path.join(ROOT, "client"),
  Object.keys(clientPackage.dependencies).filter((name) => !name.startsWith("@draft-simulator/")),
);

const noticesPath = path.join(RELEASE_DIR, "THIRD_PARTY_NOTICES.txt");
fs.writeFileSync(
  noticesPath,
  buildThirdPartyNotices({
    projectLicense: fs.readFileSync(path.join(ROOT, "LICENSE"), "utf8"),
    nodeVersion: process.version,
    nodeLicense: await readNodeLicense(),
    packages: [...new Set([...serverPackageDirs, ...clientPackageDirs])].map(readPackageNotice),
  }),
);
console.log(`Wrote ${noticesPath}`);

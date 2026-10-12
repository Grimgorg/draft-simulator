import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildThirdPartyNotices,
  collectDependencyDirs,
  packageDirOf,
  readPackageNotice,
  type PackageNotice,
} from "./thirdPartyNotices.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "draft-simulator-notices-"));
}

/** Writes a fake installed package and returns its folder. */
function installPackage(
  parentDir: string,
  name: string,
  pkg: Record<string, unknown> = {},
  files: Record<string, string> = {},
): string {
  const dir = path.join(parentDir, "node_modules", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", license: "MIT", ...pkg }));
  for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), content);
  return dir;
}

function notice(name: string, version: string, licenseText = `${name} license`): PackageNotice {
  return { name, version, license: "MIT", licenseText };
}

test("finds the package folder of a bundled file, including scoped and nested packages", () => {
  const root = path.resolve("/repo");
  assert.equal(packageDirOf("/repo/node_modules/express/lib/router/index.js"), path.join(root, "node_modules/express"));
  assert.equal(
    packageDirOf("/repo/node_modules/@socket.io/component-emitter/lib/esm/index.js"),
    path.join(root, "node_modules/@socket.io/component-emitter"),
  );
  assert.equal(
    packageDirOf("/repo/node_modules/send/node_modules/ms/index.js"),
    path.join(root, "node_modules/send/node_modules/ms"),
  );
  assert.equal(packageDirOf("/repo/shared/dist/index.js"), undefined);
});

test("collects runtime dependencies transitively, resolving nested copies first and skipping absent optional ones", () => {
  const root = tmpDir();
  const app = path.join(root, "client");
  fs.mkdirSync(app);
  const a = installPackage(root, "a", { dependencies: { b: "^1", ms: "^2" }, optionalDependencies: { "other-os": "^1" } });
  const nestedMs = installPackage(a, "ms", { version: "2.1.3" });
  const b = installPackage(root, "b", { dependencies: { ms: "^2" }, devDependencies: { "dev-only": "^1" } });
  const hoistedMs = installPackage(root, "ms", { version: "2.0.0" });

  const dirs = collectDependencyDirs(app, ["a"]);

  assert.deepEqual(new Set(dirs), new Set([a, nestedMs, b, hoistedMs]));
});

test("fails loudly when a required dependency isn't installed", () => {
  const root = tmpDir();
  installPackage(root, "a", { dependencies: { missing: "^1" } });

  assert.throws(() => collectDependencyDirs(root, ["a"]), /Couldn't find the installed package "missing"/);
});

test("reads a package's license name and every license or notice file, whatever their casing", () => {
  const root = tmpDir();
  const dir = installPackage(
    root,
    "qs",
    { version: "6.15.3", license: "BSD-3-Clause" },
    { "LICENSE.md": "BSD text", NOTICE: "notice text", "license-extra.txt": "extra", "README.md": "not a license" },
  );
  const legacy = installPackage(root, "legacy", { license: undefined, licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] });

  assert.deepEqual(readPackageNotice(dir), {
    name: "qs",
    version: "6.15.3",
    license: "BSD-3-Clause",
    // Sorted by file name, uppercase first: LICENSE.md, NOTICE, license-extra.txt.
    licenseText: "BSD text\n\nnotice text\n\nextra",
  });
  assert.deepEqual(readPackageNotice(legacy), { name: "legacy", version: "1.0.0", license: "MIT OR Apache-2.0", licenseText: "" });
});

test("the notices file starts with the project and Node.js, then lists each package version once, sorted", () => {
  const text = buildThirdPartyNotices({
    projectLicense: "MIT License\n\nCopyright (c) 2026 Grimgorg",
    nodeVersion: "v24.19.0",
    nodeLicense: "Node.js is licensed for use as follows: ...",
    packages: [notice("ms", "2.1.3"), notice("express", "4.22.2"), notice("ms", "2.0.0"), notice("ms", "2.1.3")],
  });

  const titles = [...text.matchAll(/^-+\n(.+)\n-+$/gm)].map((match) => match[1]);
  assert.deepEqual(titles, [
    "Draft Simulator",
    "Node.js v24.19.0",
    "SQLite",
    "express 4.22.2 (MIT)",
    "ms 2.0.0 (MIT)",
    "ms 2.1.3 (MIT)",
  ]);
  assert.match(text, /Copyright \(c\) 2026 Grimgorg/);
  assert.match(text, /Node\.js is licensed for use as follows/);
});

test("a package without a license file is still listed, with the license its package.json declares", () => {
  const text = buildThirdPartyNotices({
    projectLicense: "MIT",
    nodeVersion: "v24.19.0",
    nodeLicense: "Node license",
    packages: [notice("cookie-signature", "1.0.7", "")],
  });

  assert.match(
    text,
    /cookie-signature 1\.0\.7 \(MIT\)\n-+\n\nThis package includes no license file\. Its package\.json declares the license: MIT\./,
  );
});

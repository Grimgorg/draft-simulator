/**
 * Builds THIRD_PARTY_NOTICES.txt, which ships next to the executable: the
 * licenses of Node.js and of every npm package inside it. Most of these
 * licenses (MIT, ISC, BSD) require their notice to travel with every copy.
 */
import fs from "node:fs";
import path from "node:path";

export interface PackageNotice {
  name: string;
  version: string;
  /** The license named in package.json, e.g. "MIT". */
  license: string;
  /** The package's license and notice files, joined; empty if it ships none. */
  licenseText: string;
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([.-]|$)/i;

/** The root folder of the npm package a file belongs to, or undefined for a file outside node_modules. */
export function packageDirOf(file: string): string | undefined {
  const parts = path.resolve(file).split(/[\\/]/);
  const index = parts.lastIndexOf("node_modules");
  if (index === -1 || index + 1 >= parts.length) return undefined;
  const nameLength = parts[index + 1]!.startsWith("@") ? 2 : 1;
  return parts.slice(0, index + 1 + nameLength).join(path.sep);
}

/** Finds an installed package the way Node does: in node_modules of the folder, then of each parent folder. */
function resolvePackageDir(name: string, fromDir: string): string | undefined {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    if (path.dirname(dir) === dir) return undefined;
  }
}

/**
 * The folders of the named packages and everything they depend on at runtime.
 * Used for the client, whose Vite build doesn't report which packages it
 * bundled, so this may list a few the browser bundle leaves out: listing
 * too many is harmless, missing one isn't.
 */
export function collectDependencyDirs(fromDir: string, names: string[]): string[] {
  const found = new Set<string>();
  const visit = (name: string, dir: string, optional: boolean): void => {
    const packageDir = resolvePackageDir(name, dir);
    if (!packageDir) {
      // An optional dependency for another platform is legitimately absent.
      if (optional) return;
      throw new Error(`Couldn't find the installed package "${name}" (needed from ${dir}). Run npm install.`);
    }
    if (found.has(packageDir)) return;
    found.add(packageDir);
    const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    for (const dependency of Object.keys(pkg.dependencies ?? {})) visit(dependency, packageDir, false);
    for (const dependency of Object.keys(pkg.optionalDependencies ?? {})) visit(dependency, packageDir, true);
  };
  for (const name of names) visit(name, fromDir, false);
  return [...found];
}

function licenseName(license: unknown): string {
  if (typeof license === "string") return license;
  // Older packages use { type: "MIT" } or a list of them.
  if (Array.isArray(license)) return license.map(licenseName).join(" OR ");
  if (license && typeof license === "object" && "type" in license) return String(license.type);
  return "UNKNOWN";
}

export function readPackageNotice(packageDir: string): PackageNotice {
  const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8")) as {
    name: string;
    version: string;
    license?: unknown;
    licenses?: unknown;
  };
  const licenseFiles = fs
    .readdirSync(packageDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && LICENSE_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  return {
    name: pkg.name,
    version: pkg.version,
    license: licenseName(pkg.license ?? pkg.licenses),
    licenseText: licenseFiles
      .map((file) => fs.readFileSync(path.join(packageDir, file), "utf8").trim())
      .join("\n\n"),
  };
}

const RULE = "-".repeat(79);

function section(title: string, body: string): string {
  return `${RULE}\n${title}\n${RULE}\n\n${body.trim()}\n`;
}

export interface NoticesInput {
  projectLicense: string;
  nodeVersion: string;
  nodeLicense: string;
  packages: PackageNotice[];
}

/** The full notices file. Packages are listed once per name and version, sorted by name. */
export function buildThirdPartyNotices({ projectLicense, nodeVersion, nodeLicense, packages }: NoticesInput): string {
  const unique = new Map<string, PackageNotice>();
  for (const notice of packages) unique.set(`${notice.name}@${notice.version}`, notice);
  const sorted = [...unique.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true }),
  );

  return [
    section("Draft Simulator", projectLicense),
    "This program includes the third-party software below, each under its own license.\n",
    section(`Node.js ${nodeVersion}`, nodeLicense),
    section(
      "SQLite",
      "SQLite is built into better-sqlite3's native addon. It is in the public domain: https://sqlite.org/copyright.html",
    ),
    ...sorted.map((notice) =>
      section(
        `${notice.name} ${notice.version} (${notice.license})`,
        notice.licenseText ||
          `This package includes no license file. Its package.json declares the license: ${notice.license}.`,
      ),
    ),
  ].join("\n");
}

import fs from "node:fs";

/** Every setting starts commented out, so a freshly created file changes nothing until the host edits it. */
export function buildExampleEnvFile(): string {
  return [
    "# Draft Simulator settings.",
    "# The port and the lobby password are easiest to change in the management UI, which saves them here.",
    '# To change a setting by hand, remove the "#" at the start of its line, then restart Draft Simulator.',
    "",
    "# Port the server listens on. Forward this TCP port on your router for friends outside your network.",
    "# PORT=4000",
    "",
    "# Password everyone must enter before joining. Strongly recommended once the port is forwarded.",
    "# LOBBY_PASSWORD=choose-a-password",
    "",
    "# Port of the management UI. Only this computer can open it.",
    "# MANAGEMENT_PORT=4001",
    "",
    "# Days before the downloaded card database is refreshed.",
    "# CARD_CACHE_MAX_AGE_DAYS=30",
    "",
  ].join("\n");
}

/** Writes the example file unless one exists; never touches a file the host already has. Returns whether it wrote one. */
export function createExampleEnvFileIfMissing(envFilePath: string): boolean {
  try {
    fs.writeFileSync(envFilePath, buildExampleEnvFile(), { flag: "wx" });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

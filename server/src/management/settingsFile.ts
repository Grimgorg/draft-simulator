import fs from "node:fs";
import type { ServerSettings } from "@draft-simulator/shared";
import { buildExampleEnvFile } from "../packaged/exampleEnvFile.js";

export const DEFAULT_PORT = 4000;

/** The settings the app started with: the .env file is already in process.env by then (loadEnvFile, or --env-file). */
export function readStartupSettings(env: NodeJS.ProcessEnv = process.env): ServerSettings {
  return {
    port: env.PORT === undefined || env.PORT === "" ? DEFAULT_PORT : Number(env.PORT),
    lobbyPassword: env.LOBBY_PASSWORD ?? "",
  };
}

/**
 * Returns what's wrong with `settings` in words the host can act on, or
 * undefined when they're fine. `managementPort` is refused for players:
 * macOS lets the draft server open it on every interface while the
 * management server holds it on 127.0.0.1, and then the host's browser
 * reaches one server and their friends the other.
 */
export function validateSettings(settings: ServerSettings, managementPort?: number): string | undefined {
  if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535) {
    return "The port must be a whole number from 1 to 65535.";
  }
  if (settings.port === managementPort) {
    return `Port ${settings.port} is the management UI's own port. Choose a different port for players.`;
  }
  // The password is written to .env in double quotes, where a quote would
  // end the value early and a backslash or line break would be read as an escape.
  if (/["\\\r\n]/.test(settings.lobbyPassword)) {
    return "The password can't contain quotes (\"), backslashes (\\) or line breaks.";
  }
  return undefined;
}

/**
 * Sets `key` in the text of a .env file. The first `KEY=` line, or else the
 * first commented-out `# KEY=` line, becomes the new value. Any other active
 * line for the key is removed, so it can't override the new one. Every
 * other line is left as it was. A null value leaves the key commented out.
 */
export function setEnvValue(text: string, key: string, value: string | null): string {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const isActive = (line: string) => new RegExp(`^\\s*${key}\\s*=`).test(line);
  const isCommented = (line: string) => new RegExp(`^\\s*#\\s*${key}\\s*=`).test(line);
  const replacement = value === null ? `# ${key}=` : `${key}=${value}`;

  let target = lines.findIndex(isActive);
  if (target === -1) target = lines.findIndex(isCommented);
  if (target === -1) {
    if (value === null) return text;
    // Before the final empty string a trailing newline leaves, so the file still ends with one.
    const insertAt = lines.at(-1) === "" ? lines.length - 1 : lines.length;
    lines.splice(insertAt, 0, replacement);
    return lines.join(newline);
  }

  return lines
    .flatMap((line, i) => {
      if (i === target) return [replacement];
      return isActive(line) ? [] : [line];
    })
    .join(newline);
}

/** Saves the port and password into the .env file, creating it from the example when there's none. */
export function writeSettings(envFilePath: string, settings: ServerSettings): void {
  let text: string;
  try {
    text = fs.readFileSync(envFilePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    text = buildExampleEnvFile();
  }
  text = setEnvValue(text, "PORT", String(settings.port));
  text = setEnvValue(text, "LOBBY_PASSWORD", settings.lobbyPassword ? `"${settings.lobbyPassword}"` : null);
  fs.writeFileSync(envFilePath, text);
}

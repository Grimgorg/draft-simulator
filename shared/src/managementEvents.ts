import type { DraftSettings } from "./draft.js";
import type { ActionResult } from "./events.js";
import type { LobbyStateView } from "./lobbyView.js";

export type LogLevel = "info" | "warn" | "error";

/** One line of the server's console output, as the management UI's log viewer shows it. */
export interface LogEntry {
  /** Goes up by one per entry, so the UI can key entries and skip ones it already has. */
  id: number;
  /** Milliseconds since the epoch. */
  time: number;
  level: LogLevel;
  message: string;
}

/** Where Draft Simulator's source code and releases are. */
export const REPOSITORY_URL = "https://github.com/Grimgorg/draft-simulator";

/**
 * What the management UI can ask the server to open in the system browser. A
 * name rather than a URL, so the page can't make the server open anything else.
 */
export type BrowserTarget = "playerPage" | "repository";

export type DraftServerStatus = "stopped" | "starting" | "running" | "stopping" | "failed";

/** The settings the host can change in the management UI. Saved in the .env file. */
export interface ServerSettings {
  port: number;
  /** Empty means no password: anyone who can reach the port can join. */
  lobbyPassword: string;
}

/** What the host picks for a new draft. The cube is fetched from CubeCobra when the draft is created. */
export type NewDraftSettings = { cubeIdOrUrl: string } & Omit<DraftSettings, "cubeId">;

/**
 * Everything the management UI shows, sent only to the management UI, which
 * is reachable from the host's own computer only. Pack contents and pools
 * stay out of it like they stay out of lobby:state: the host is a player too.
 */
export interface ManagementStateView {
  server: {
    status: DraftServerStatus;
    /** The settings the server is running with, while it runs. */
    running?: ServerSettings;
    /** Why the last start failed, when status is "failed". */
    error?: string;
  };
  /** The saved settings, which the next start uses. */
  settings: ServerSettings;
  /** True while the server runs with settings other than the saved ones. */
  restartRequired: boolean;
  /** The .env file the settings are saved in. */
  envFilePath: string;
  /** This computer's IPv4 addresses on the local network, for friends on the same network. */
  lanAddresses: string[];
  /** Open player connections, including browsers that haven't taken a seat. */
  playerConnections: number;
  cardDatabase: { cardCount: number; lastImportedAt: string | null; refreshing: boolean };
  lobby: LobbyStateView;
}

/** Events the management UI emits to the server. */
export interface ManagementClientToServerEvents {
  "manage:startServer": (callback: (result: ActionResult) => void) => void;
  "manage:stopServer": (callback: (result: ActionResult) => void) => void;
  /** Stops the server if it runs, then starts it with the saved settings. */
  "manage:restartServer": (callback: (result: ActionResult) => void) => void;
  /** Validates and saves the settings. They take effect at the next start. */
  "manage:saveSettings": (payload: ServerSettings, callback: (result: ActionResult) => void) => void;
  /**
   * Opens the target in the host's default browser. The server does it: in the
   * desktop app a link would replace the management UI in its only window.
   */
  "manage:openInBrowser": (target: BrowserTarget, callback: (result: ActionResult) => void) => void;
  /** Imports the cube and opens a lobby players can join. Replaces a completed draft, never an active one. */
  "manage:createDraft": (payload: NewDraftSettings, callback: (result: ActionResult) => void) => void;
  /** Deals the first packs. Only once every seat is filled. */
  "manage:startDraft": (callback: (result: ActionResult) => void) => void;
  /** Ends an open lobby or a draft under way for everyone, back to no draft at all. */
  "manage:cancelDraft": (callback: (result: ActionResult) => void) => void;
}

/** Events the server emits to the management UI. */
export interface ManagementServerToClientEvents {
  /** Sent on connect and after every change. */
  "manage:state": (state: ManagementStateView) => void;
  /** Sent on connect: the most recent log entries, oldest first. */
  "manage:logHistory": (entries: LogEntry[]) => void;
  "manage:log": (entry: LogEntry) => void;
}

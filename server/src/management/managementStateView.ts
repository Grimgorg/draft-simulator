import os from "node:os";
import type { DraftSummary, ManagementStateView, ServerSettings } from "@draft-simulator/shared";
import type { DraftServerState } from "./draftServer.js";

export interface ManagementStateInputs {
  server: DraftServerState;
  savedSettings: ServerSettings;
  envFilePath: string;
  lanAddresses: string[];
  playerConnections: number;
  cardDatabase: ManagementStateView["cardDatabase"];
  drafts: DraftSummary[];
}

export function buildManagementStateView(inputs: ManagementStateInputs): ManagementStateView {
  const { server, savedSettings } = inputs;
  const running = server.status === "running" ? server.running : undefined;
  return {
    server: { status: server.status, running, error: server.status === "failed" ? server.error : undefined },
    settings: savedSettings,
    restartRequired:
      running !== undefined &&
      (running.port !== savedSettings.port || running.lobbyPassword !== savedSettings.lobbyPassword),
    envFilePath: inputs.envFilePath,
    lanAddresses: inputs.lanAddresses,
    playerConnections: inputs.playerConnections,
    cardDatabase: inputs.cardDatabase,
    drafts: inputs.drafts,
  };
}

/** This computer's IPv4 addresses on its networks, which friends on the same network can open. */
export function listLanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((address) => address !== undefined && address.family === "IPv4" && !address.internal)
    .map((address) => address!.address);
}

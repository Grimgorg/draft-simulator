import { useEffect, useState } from "react";
import type { LogEntry, ManagementStateView } from "@draft-simulator/shared";
import { managementSocket } from "./managementSocket.js";

/** The server keeps as many; more would only make the log viewer slower. */
const MAX_LOG_ENTRIES = 2000;

export interface ManagementConnection {
  connected: boolean;
  state: ManagementStateView | null;
  /** Oldest first. */
  logs: LogEntry[];
}

/** The only code in the management UI that listens to socket events. */
export function useManagementConnection(): ManagementConnection {
  const [connected, setConnected] = useState(managementSocket.connected);
  const [state, setState] = useState<ManagementStateView | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    function onConnect() {
      setConnected(true);
    }
    function onDisconnect() {
      setConnected(false);
    }
    // Sent again on every reconnect, so it replaces what's there rather than adding to it.
    function onLogHistory(entries: LogEntry[]) {
      setLogs(entries);
    }
    function onLog(entry: LogEntry) {
      setLogs((previous) => {
        if (previous.length > 0 && previous[previous.length - 1].id >= entry.id) return previous;
        const next = [...previous, entry];
        return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
      });
    }

    managementSocket.on("connect", onConnect);
    managementSocket.on("disconnect", onDisconnect);
    managementSocket.on("manage:state", setState);
    managementSocket.on("manage:logHistory", onLogHistory);
    managementSocket.on("manage:log", onLog);
    if (!managementSocket.connected) managementSocket.connect();

    return () => {
      managementSocket.off("connect", onConnect);
      managementSocket.off("disconnect", onDisconnect);
      managementSocket.off("manage:state", setState);
      managementSocket.off("manage:logHistory", onLogHistory);
      managementSocket.off("manage:log", onLog);
    };
  }, []);

  return { connected, state, logs };
}

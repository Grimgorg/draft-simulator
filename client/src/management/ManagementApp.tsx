import { DraftPanel } from "./components/DraftPanel.js";
import { InvitePanel } from "./components/InvitePanel.js";
import { LogViewer } from "./components/LogViewer.js";
import { PlayersPanel } from "./components/PlayersPanel.js";
import { ServerPanel } from "./components/ServerPanel.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { StatusBadge } from "./components/StatusBadge.js";
import { useManagementConnection } from "./useManagementConnection.js";

/** The host's window onto the server: start and stop it, see who's in the draft, change settings, read the logs. */
export function ManagementApp() {
  const { connected, state, logs } = useManagementConnection();

  return (
    <div className="manage">
      <header className="manage-header">
        <h1>Draft Simulator</h1>
        {state && <StatusBadge status={state.server.status} />}
      </header>

      {!connected && (
        <p className="manage-banner manage-banner-error" role="alert">
          {state ? "Lost the connection to Draft Simulator. Reconnecting..." : "Connecting to Draft Simulator..."}
        </p>
      )}

      {state && (
        <div className="manage-grid">
          <div className="manage-column">
            <ServerPanel state={state} />
            <InvitePanel state={state} />
            <SettingsPanel state={state} />
          </div>
          <div className="manage-column">
            <DraftPanel lobby={state.lobby} />
            <PlayersPanel lobby={state.lobby} playerConnections={state.playerConnections} />
          </div>
        </div>
      )}

      <LogViewer entries={logs} />
    </div>
  );
}

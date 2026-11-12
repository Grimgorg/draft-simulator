import { useState } from "react";
import { AppFooter } from "./components/AppFooter.js";
import { DraftsPanel } from "./components/DraftsPanel.js";
import { InvitePanel } from "./components/InvitePanel.js";
import { LogViewer } from "./components/LogViewer.js";
import { ServerPanel } from "./components/ServerPanel.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { StatusBadge } from "./components/StatusBadge.js";
import { useManagementConnection } from "./useManagementConnection.js";

type Tab = "draft" | "settings" | "logs";

const TAB_LABELS: Record<Tab, string> = { draft: "Draft", settings: "Settings", logs: "Logs" };

/** The host's window onto the server: start and stop it, see its drafts, change settings, read the logs. */
export function ManagementApp() {
  const { connected, state, logs } = useManagementConnection();
  const [tab, setTab] = useState<Tab>("draft");

  // Hidden tabs still say when they need a look, so a pending restart or a new error isn't missed.
  const problemCount = logs.filter((entry) => entry.level !== "info").length;
  const hints: Record<Tab, string | null> = {
    draft: null,
    settings: state?.restartRequired ? "Restart required" : null,
    logs: problemCount > 0 ? String(problemCount) : null,
  };

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

      <div className="manage-tabs" role="tablist" aria-label="Sections">
        {(Object.keys(TAB_LABELS) as Tab[]).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`tabpanel-${id}`}
            onClick={() => setTab(id)}
          >
            {TAB_LABELS[id]}
            {hints[id] && <span className="tab-hint">{hints[id]}</span>}
          </button>
        ))}
      </div>

      {/* Kept mounted while hidden, so unsaved settings and the log's scroll position survive a tab switch. */}
      <div role="tabpanel" id="tabpanel-draft" aria-labelledby="tab-draft" hidden={tab !== "draft"}>
        {state && (
          <div className="manage-grid">
            <div className="manage-column">
              <ServerPanel state={state} />
              <InvitePanel state={state} />
            </div>
            <div className="manage-column">
              <DraftsPanel drafts={state.drafts} playerConnections={state.playerConnections} />
            </div>
          </div>
        )}
      </div>
      <div role="tabpanel" id="tabpanel-settings" aria-labelledby="tab-settings" hidden={tab !== "settings"}>
        {state && <SettingsPanel state={state} />}
      </div>
      <div
        role="tabpanel"
        id="tabpanel-logs"
        className="manage-logs-tab"
        aria-labelledby="tab-logs"
        hidden={tab !== "logs"}
      >
        <LogViewer entries={logs} visible={tab === "logs"} />
      </div>

      <AppFooter />
    </div>
  );
}

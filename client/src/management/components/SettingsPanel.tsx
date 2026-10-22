import { useState } from "react";
import type { ManagementStateView } from "@draft-simulator/shared";
import { ConfirmButton } from "../../components/ConfirmButton.js";
import { isDraftActive } from "../lobbyStatus.js";
import { managementSocket } from "../managementSocket.js";
import { useManagementAction } from "../useManagementAction.js";

interface SettingsPanelProps {
  state: ManagementStateView;
}

export function SettingsPanel({ state }: SettingsPanelProps) {
  const saved = state.settings;
  const [port, setPort] = useState(String(saved.port));
  const [password, setPassword] = useState(saved.lobbyPassword);
  const [justSaved, setJustSaved] = useState(false);
  const [shownSaved, setShownSaved] = useState(saved);
  const save = useManagementAction();
  const restart = useManagementAction();

  // Shows the saved values once they change: after a save here (the server
  // trims the password), or from another window on the same app.
  if (saved.port !== shownSaved.port || saved.lobbyPassword !== shownSaved.lobbyPassword) {
    setShownSaved(saved);
    setPort(String(saved.port));
    setPassword(saved.lobbyPassword);
  }

  const changed = port !== String(saved.port) || password !== saved.lobbyPassword;
  const restartServer = () => restart.run((callback) => managementSocket.emit("manage:restartServer", callback));

  return (
    <section className="panel" aria-labelledby="settings-heading">
      <h2 id="settings-heading">Settings</h2>
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          setJustSaved(false);
          save.run(
            (callback) => managementSocket.emit("manage:saveSettings", { port: Number(port), lobbyPassword: password }, callback),
            () => setJustSaved(true),
          );
        }}
      >
        <label>
          Port
          <input
            inputMode="numeric"
            value={port}
            onChange={(e) => {
              setPort(e.target.value);
              setJustSaved(false);
            }}
          />
        </label>
        <label>
          Lobby password
          <input
            value={password}
            placeholder="None"
            autoComplete="off"
            onChange={(e) => {
              setPassword(e.target.value);
              setJustSaved(false);
            }}
          />
          <span className="muted">Everyone enters it before they can join. Leave it empty for no password.</span>
        </label>
        <button type="submit" disabled={!changed || save.pending}>
          Save settings
        </button>
        {save.error && (
          <p className="error" role="alert">
            {save.error}
          </p>
        )}
        {justSaved && !state.restartRequired && (
          <p className="muted" role="status">
            Saved in {state.envFilePath}.
          </p>
        )}
      </form>

      {state.restartRequired && (
        <div className="manage-banner" role="status">
          <p>Saved. The server is still running with the old settings: restart it to use the new ones.</p>
          {isDraftActive(state.lobby) ? (
            <ConfirmButton
              label="Restart now"
              confirmMessage="Restart the server? Players are disconnected for a moment. With a new port or password, send them the new details."
              confirmLabel="Restart"
              disabled={restart.pending}
              onConfirm={restartServer}
            />
          ) : (
            <button type="button" disabled={restart.pending} onClick={restartServer}>
              Restart now
            </button>
          )}
          {restart.error && (
            <p className="error" role="alert">
              {restart.error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

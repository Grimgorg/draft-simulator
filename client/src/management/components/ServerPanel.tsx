import type { ManagementStateView } from "@draft-simulator/shared";
import { ConfirmButton } from "../../components/ConfirmButton.js";
import { isDraftActive } from "../lobbyStatus.js";
import { managementSocket } from "../managementSocket.js";
import { useManagementAction } from "../useManagementAction.js";

interface ServerPanelProps {
  state: ManagementStateView;
}

function describeCardDatabase({ cardCount, lastImportedAt, refreshing }: ManagementStateView["cardDatabase"]): string {
  if (refreshing && cardCount === 0) return "Downloading the card database. The first time takes about a minute.";
  if (refreshing) return "Updating the card database in the background...";
  const updated = lastImportedAt ? new Date(lastImportedAt).toLocaleDateString() : "never";
  return `Card database: ${cardCount.toLocaleString()} cards, updated ${updated}.`;
}

export function ServerPanel({ state }: ServerPanelProps) {
  const { pending, error, run } = useManagementAction();
  const { status, running, error: startError } = state.server;
  const draftActive = isDraftActive(state.lobby);

  const start = () => run((callback) => managementSocket.emit("manage:startServer", callback));
  const stop = () => run((callback) => managementSocket.emit("manage:stopServer", callback));
  const restart = () => run((callback) => managementSocket.emit("manage:restartServer", callback));

  return (
    <section className="panel" aria-labelledby="server-heading">
      <h2 id="server-heading">Server</h2>
      {status === "running" && running && <p>Running on port {running.port}. Players can connect.</p>}
      {status === "stopped" && <p>Stopped. Players can't connect until you start it.</p>}
      {status === "starting" && <p>Starting...</p>}
      {status === "stopping" && <p>Stopping...</p>}
      {status === "failed" && (
        <p className="error" role="alert">
          {startError ?? "The server couldn't start."}
        </p>
      )}

      <div className="panel-actions">
        {(status === "stopped" || status === "failed") && (
          <button type="button" disabled={pending} onClick={start}>
            Start server
          </button>
        )}
        {status === "running" &&
          (draftActive ? (
            <>
              <ConfirmButton
                label="Restart server"
                confirmMessage="Restart the server? Players are disconnected for a moment, then reconnect on their own."
                confirmLabel="Restart"
                disabled={pending}
                onConfirm={restart}
              />
              <ConfirmButton
                label="Stop server"
                className="danger-button"
                confirmMessage="Stop the server? Players are disconnected until you start it again. The draft is kept."
                confirmLabel="Stop"
                disabled={pending}
                onConfirm={stop}
              />
            </>
          ) : (
            <>
              <button type="button" disabled={pending} onClick={restart}>
                Restart server
              </button>
              <button type="button" className="danger-button" disabled={pending} onClick={stop}>
                Stop server
              </button>
            </>
          ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <p className="muted">{describeCardDatabase(state.cardDatabase)}</p>
    </section>
  );
}

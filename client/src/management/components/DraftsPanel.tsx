import { WINSTON_PLAYERS, type DraftStatus, type DraftSummary } from "@draft-simulator/shared";
import { ConfirmButton } from "../../components/ConfirmButton.js";
import { managementSocket } from "../managementSocket.js";
import { useManagementAction } from "../useManagementAction.js";

interface DraftsPanelProps {
  drafts: DraftSummary[];
  /** Open player connections, including browsers that haven't taken a seat. */
  playerConnections: number;
}

const STATUS_LABELS: Record<DraftStatus, string> = {
  lobby: "Waiting for players",
  drafting: "Drafting",
  complete: "Finished",
};

interface DraftRowProps {
  draft: DraftSummary;
}

function DraftRow({ draft }: DraftRowProps) {
  const { pending, error, run } = useManagementAction();
  const { settings } = draft;
  const isWinston = settings.format === "winston";
  const finished = draft.status === "complete";
  const close = () => run((callback) => managementSocket.emit("manage:closeDraft", draft.draftId, callback));
  const releaseSeat = (playerId: string) =>
    run((callback) => managementSocket.emit("manage:releaseSeat", { draftId: draft.draftId, playerId }, callback));

  return (
    <li className="manage-draft">
      <div className="manage-draft-heading">
        <span className="player-name">{draft.cubeName}</span>
        <span className={draft.status === "drafting" ? "tag tag-active" : "tag"}>{STATUS_LABELS[draft.status]}</span>
      </div>
      <p className="muted">
        {isWinston ? `Winston draft for ${WINSTON_PLAYERS}` : "Normal draft"} &middot; {settings.packCount} packs of{" "}
        {settings.packSize}
      </p>
      {draft.players.length === 0 ? (
        <p className="muted">No players yet.</p>
      ) : (
        <ul className="manage-players">
          {draft.players.map((player) => (
            <li key={player.id}>
              <span className={`status-dot ${player.connected ? "dot-on" : "dot-off"}`} aria-hidden="true" />
              <span className="player-name">{player.name}</span>
              <span className="muted">{player.connected ? "Connected" : "Disconnected"}</span>
              {player.id === draft.creatorPlayerId && <span className="tag">Creator</span>}
              {player.claimable ? (
                <span className="tag">Released</span>
              ) : (
                <ConfirmButton
                  label="Release seat"
                  className="secondary-button"
                  confirmMessage={
                    `Release ${player.name}'s seat? Whoever picks ${player.name} in the draft's rejoin list next ` +
                    "takes it, on any device."
                  }
                  confirmLabel="Release"
                  disabled={pending}
                  onConfirm={() => releaseSeat(player.id)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="panel-actions">
        <ConfirmButton
          label={finished ? "Close draft" : "Cancel draft"}
          className="danger-button"
          confirmMessage={
            finished
              ? "Close this draft? It's removed for everyone, with their pools and decks."
              : "Cancel this draft? Everyone in it is removed and all picks are lost. This can't be undone."
          }
          confirmLabel={finished ? "Yes, close draft" : "Yes, cancel draft"}
          disabled={pending}
          onConfirm={close}
        />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * Every draft on the server, as players see them. Players create, start and close their own drafts; the host can
 * close any of them, for one that's stuck or whose creator is gone.
 */
export function DraftsPanel({ drafts, playerConnections }: DraftsPanelProps) {
  return (
    <section className="panel" aria-labelledby="drafts-heading">
      <h2 id="drafts-heading">Drafts</h2>
      {drafts.length === 0 ? (
        <p className="muted">No drafts yet. Players create them from the player page.</p>
      ) : (
        <ul className="manage-drafts">
          {drafts.map((draft) => (
            <DraftRow key={draft.draftId} draft={draft} />
          ))}
        </ul>
      )}
      <p className="muted">
        {playerConnections} {playerConnections === 1 ? "browser" : "browsers"} connected
      </p>
    </section>
  );
}

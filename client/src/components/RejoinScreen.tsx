import { useState } from "react";
import type { DraftSummary } from "@draft-simulator/shared";
import type { StoredSeat } from "../playerIdentity.js";
import { socket } from "../socket.js";
import { JoinScreen } from "./JoinScreen.js";

interface RejoinScreenProps {
  draft: DraftSummary;
  /** Fired after either a successful rejoin or a successful new-player join. */
  onIdentitySelected: (seat: StoredSeat) => void;
  /** Back to the draft list. */
  onBack: () => void;
}

/**
 * Shown for a draft picked from the draft list: join it as a new player while it waits for players, or take
 * back a seat in it — from a fresh device, cleared storage, or just picking a different seat. The player list
 * (with ids) is already public, so this just turns something already possible via devtools into a real UI.
 */
export function RejoinScreen({ draft, onIdentitySelected, onBack }: RejoinScreenProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleRejoin(playerId: string) {
    setPendingId(playerId);
    setError(null);
    socket.emit("lobby:reconnect", { draftId: draft.draftId, playerId }, (result) => {
      setPendingId(null);
      if (result.ok) {
        onIdentitySelected({ draftId: draft.draftId, playerId });
      } else {
        setError(result.error);
      }
    });
  }

  const canJoinNew = draft.status === "lobby";

  return (
    <div className="screen">
      <button type="button" className="secondary-button back-button" onClick={onBack}>
        ◀ All drafts
      </button>
      <h1>{draft.cubeName}</h1>
      <p className="subtitle">
        {draft.cardCount} cards &middot; {draft.settings.packCount} packs of {draft.settings.packSize}
      </p>

      {draft.players.length > 0 && (
        <>
          <h2>Rejoin as...</h2>
          <p className="subtitle">Pick your name to rejoin the draft on this device.</p>
          {error && <p className="error">{error}</p>}
          <ul className="player-list rejoin-list">
            {draft.players.map((player) => (
              <li key={player.id}>
                <button
                  type="button"
                  className="rejoin-button"
                  onClick={() => handleRejoin(player.id)}
                  disabled={pendingId !== null}
                >
                  <span className={`dot ${player.connected ? "dot-connected" : "dot-disconnected"}`} />
                  {player.name}
                  {pendingId === player.id && " ..."}
                </button>
                {player.connected && (
                  <span className="warning-inline">connected elsewhere — rejoining will sign that session out</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {canJoinNew && <JoinScreen draft={draft} onJoined={onIdentitySelected} />}
    </div>
  );
}

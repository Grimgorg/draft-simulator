import { useState } from "react";
import type { DraftSummary } from "@draft-simulator/shared";
import { getStoredSeat, type StoredSeat } from "../playerIdentity.js";
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
 * back a seat in it. Only this browser's own seat (it has the seat's token) and claimable seats can be taken: a
 * player on a new device asks the draft's creator or the host to release their seat first.
 */
export function RejoinScreen({ draft, onIdentitySelected, onBack }: RejoinScreenProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stored = getStoredSeat();
  const ownSeat = stored?.draftId === draft.draftId ? stored : null;

  function handleRejoin(playerId: string) {
    setPendingId(playerId);
    setError(null);
    const seatToken = ownSeat?.playerId === playerId ? ownSeat.seatToken : undefined;
    socket.emit("lobby:reconnect", { draftId: draft.draftId, playerId, seatToken }, (result) => {
      setPendingId(null);
      if (result.ok) {
        onIdentitySelected({ draftId: draft.draftId, playerId, seatToken: result.seatToken });
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
            {draft.players.map((player) => {
              const takeable = player.claimable || ownSeat?.playerId === player.id;
              return (
                <li key={player.id}>
                  <button
                    type="button"
                    className="rejoin-button"
                    onClick={() => handleRejoin(player.id)}
                    disabled={pendingId !== null || !takeable}
                  >
                    <span className={`dot ${player.connected ? "dot-connected" : "dot-disconnected"}`} />
                    {player.name}
                    {pendingId === player.id && " ..."}
                  </button>
                  {!takeable ? (
                    <span className="muted">
                      held by another browser — ask the draft's creator or the host to release it
                    </span>
                  ) : (
                    player.connected && (
                      <span className="warning-inline">connected elsewhere — rejoining will sign that session out</span>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {canJoinNew && <JoinScreen draft={draft} onJoined={onIdentitySelected} />}
    </div>
  );
}

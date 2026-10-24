import { useState } from "react";
import type { LobbyStateView } from "@draft-simulator/shared";
import { socket } from "../socket.js";
import { JoinScreen } from "./JoinScreen.js";

interface RejoinScreenProps {
  lobbyState: LobbyStateView;
  /** Fired after either a successful rejoin or a successful new-player join. */
  onIdentitySelected: (playerId: string) => void;
}

/**
 * Shown whenever this browser isn't seated as any known player — a fresh
 * device, cleared storage, or just picking a different seat. Works at any
 * draft status: the player list (with ids) is already public, so this just
 * turns something already possible via devtools into a real UI.
 */
export function RejoinScreen({ lobbyState, onIdentitySelected }: RejoinScreenProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleRejoin(playerId: string) {
    setPendingId(playerId);
    setError(null);
    socket.emit("lobby:reconnect", { playerId }, (result) => {
      setPendingId(null);
      if (result.ok) {
        onIdentitySelected(playerId);
      } else {
        setError(result.error);
      }
    });
  }

  const canJoinNew =
    lobbyState.status === "lobby" && lobbyState.players.length < (lobbyState.settings?.playerCount ?? 0);

  return (
    <div className="screen">
      <h1>{lobbyState.cubeName ?? "Draft Simulator"}</h1>
      {lobbyState.cardCount !== undefined && (
        <p className="subtitle">
          {lobbyState.cardCount} cards &middot; {lobbyState.settings?.packCount} packs of{" "}
          {lobbyState.settings?.packSize}
        </p>
      )}

      {/* A new lobby has no one to rejoin as: the host joins it like everyone else. */}
      {lobbyState.players.length > 0 && (
        <>
          <h2>Rejoin as...</h2>
          <p className="subtitle">Pick your name to rejoin the draft on this device.</p>
          {error && <p className="error">{error}</p>}
          <ul className="player-list rejoin-list">
            {lobbyState.players.map((player) => (
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

      {canJoinNew && <JoinScreen lobbyState={lobbyState} onJoined={onIdentitySelected} />}
    </div>
  );
}

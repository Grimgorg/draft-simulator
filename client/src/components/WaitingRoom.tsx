import { useState } from "react";
import type { LobbyStateView } from "@draft-simulator/shared";
import { socket } from "../socket.js";
import { CancelDraftButton } from "./CancelDraftButton.js";

interface WaitingRoomProps {
  lobbyState: LobbyStateView;
  myPlayerId: string;
}

export function WaitingRoom({ lobbyState, myPlayerId }: WaitingRoomProps) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isHost = lobbyState.hostId === myPlayerId;
  const isFull = lobbyState.players.length === lobbyState.settings?.playerCount;

  function handleStart() {
    setStarting(true);
    setError(null);
    socket.emit("draft:start", (result) => {
      setStarting(false);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="screen">
      <h1>{lobbyState.cubeName}</h1>
      <p className="subtitle">
        {lobbyState.cardCount} cards &middot; {lobbyState.settings?.packCount} packs of{" "}
        {lobbyState.settings?.packSize} &middot; {lobbyState.players.length} / {lobbyState.settings?.playerCount}{" "}
        players
      </p>
      {lobbyState.unresolvedCardNames && lobbyState.unresolvedCardNames.length > 0 && (
        <p className="warning">
          {lobbyState.unresolvedCardNames.length} card(s) from this cube couldn't be found and were skipped:{" "}
          {lobbyState.unresolvedCardNames.join(", ")}
        </p>
      )}

      <ul className="player-list">
        {lobbyState.players.map((player) => (
          <li key={player.id}>
            <span className={`dot ${player.connected ? "dot-connected" : "dot-disconnected"}`} />
            {player.name}
            {player.isHost && <span className="tag">host</span>}
            {player.id === myPlayerId && <span className="tag">you</span>}
          </li>
        ))}
      </ul>

      {isHost ? (
        <>
          {error && <p className="error">{error}</p>}
          <button type="button" onClick={handleStart} disabled={!isFull || starting}>
            {starting ? "Starting..." : isFull ? "Start draft" : "Waiting for more players..."}
          </button>
          <CancelDraftButton />
        </>
      ) : (
        <p className="subtitle">Waiting for the host to start the draft...</p>
      )}
    </div>
  );
}

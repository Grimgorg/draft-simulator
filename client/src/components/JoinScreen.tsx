import { useState } from "react";
import type { LobbyStateView } from "@draft-simulator/shared";
import { socket } from "../socket.js";

interface JoinScreenProps {
  lobbyState: LobbyStateView;
  onJoined: (playerId: string) => void;
}

export function JoinScreen({ lobbyState, onJoined }: JoinScreenProps) {
  const [playerName, setPlayerName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    socket.emit("lobby:join", { playerName }, (result) => {
      setSubmitting(false);
      if (result.ok) {
        onJoined(result.playerId);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="screen">
      <h1>{lobbyState.cubeName ?? "Draft Simulator"}</h1>
      <p className="subtitle">
        {lobbyState.cardCount} cards &middot; {lobbyState.settings?.playerCount} players &middot;{" "}
        {lobbyState.settings?.packCount} packs of {lobbyState.settings?.packSize}
      </p>
      <p className="subtitle">
        {lobbyState.players.length} / {lobbyState.settings?.playerCount} joined
      </p>
      <form className="form" onSubmit={handleSubmit}>
        <label>
          Your name
          <input value={playerName} onChange={(e) => setPlayerName(e.target.value)} required autoFocus />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Joining..." : "Join draft"}
        </button>
      </form>
    </div>
  );
}

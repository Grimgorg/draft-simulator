import { useState } from "react";
import type { DraftSummary } from "@draft-simulator/shared";
import type { StoredSeat } from "../playerIdentity.js";
import { socket } from "../socket.js";

interface JoinScreenProps {
  draft: DraftSummary;
  onJoined: (seat: StoredSeat) => void;
}

/** The "new player" form, embedded inside RejoinScreen whenever the lobby still has an open seat. */
export function JoinScreen({ draft, onJoined }: JoinScreenProps) {
  const [playerName, setPlayerName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    socket.emit("lobby:join", { draftId: draft.draftId, playerName }, (result) => {
      setSubmitting(false);
      if (result.ok) {
        onJoined({ draftId: draft.draftId, playerId: result.playerId });
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <h2>Join as a new player</h2>
      <p className="subtitle">
        {draft.players.length} joined
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
    </>
  );
}

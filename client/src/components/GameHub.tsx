import { useState } from "react";
import type { HubStateView } from "@draft-simulator/shared";
import { socket } from "../socket.js";

interface GameHubProps {
  hubState: HubStateView;
  myPlayerId: string;
  incomingChallenge: { fromId: string; fromName: string } | null;
}

function statusLabel(status: HubStateView["players"][number]["status"]): string {
  switch (status) {
    case "not-ready":
      return "building deck";
    case "in-match":
      return "in a match";
    case "idle":
      return "ready";
  }
}

export function GameHub({ hubState, myPlayerId, incomingChallenge }: GameHubProps) {
  const [unreadying, setUnreadying] = useState(false);
  const [challengingId, setChallengingId] = useState<string | null>(null);
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleEditDeck() {
    setUnreadying(true);
    setError(null);
    socket.emit("deck:unready", (result) => {
      setUnreadying(false);
      if (!result.ok) setError(result.error);
    });
  }

  function handleChallenge(opponentId: string) {
    setChallengingId(opponentId);
    setError(null);
    socket.emit("hub:challenge", { opponentId }, (result) => {
      setChallengingId(null);
      if (!result.ok) setError(result.error);
    });
  }

  function handleRespond(accept: boolean) {
    if (!incomingChallenge) return;
    setResponding(true);
    setError(null);
    socket.emit("hub:respondChallenge", { fromId: incomingChallenge.fromId, accept }, (result) => {
      setResponding(false);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="screen">
      <h1>Game hub</h1>
      <p className="subtitle">Players who are ready can be challenged to a match.</p>

      {incomingChallenge && (
        <div className="challenge-banner">
          <p>{incomingChallenge.fromName} has challenged you to a match.</p>
          <div className="form-row">
            <button type="button" onClick={() => handleRespond(true)} disabled={responding}>
              Accept
            </button>
            <button type="button" onClick={() => handleRespond(false)} disabled={responding}>
              Decline
            </button>
          </div>
        </div>
      )}

      <ul className="player-list">
        {hubState.players.map((player) => {
          const isMe = player.id === myPlayerId;
          const challengeable = !isMe && player.status === "idle";
          return (
            <li key={player.id}>
              <span className={`dot ${player.status === "not-ready" ? "dot-disconnected" : "dot-connected"}`} />
              {player.name}
              {isMe && <span className="tag">you</span>}
              <span className="tag">{statusLabel(player.status)}</span>
              {challengeable && (
                <button type="button" onClick={() => handleChallenge(player.id)} disabled={challengingId === player.id}>
                  {challengingId === player.id ? "..." : "Challenge"}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {error && <p className="error">{error}</p>}
      <button type="button" onClick={handleEditDeck} disabled={unreadying}>
        {unreadying ? "..." : "Edit deck"}
      </button>
    </div>
  );
}

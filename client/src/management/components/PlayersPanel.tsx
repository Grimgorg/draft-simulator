import type { LobbyStateView } from "@draft-simulator/shared";

interface PlayersPanelProps {
  lobby: LobbyStateView;
  playerConnections: number;
}

export function PlayersPanel({ lobby, playerConnections }: PlayersPanelProps) {
  const waitingOn = new Set(lobby.waitingOn ?? []);
  const drafting = lobby.status === "drafting";

  return (
    <section className="panel" aria-labelledby="players-heading">
      <h2 id="players-heading">Players</h2>
      {lobby.players.length === 0 ? (
        <p className="muted">No players yet.</p>
      ) : (
        <ul className="manage-players">
          {lobby.players.map((player) => (
            <li key={player.id}>
              <span className={`status-dot ${player.connected ? "dot-on" : "dot-off"}`} aria-hidden="true" />
              <span className="player-name">{player.name}</span>
              {player.isHost && <span className="tag">Host</span>}
              <span className="muted">{player.connected ? "Connected" : "Disconnected"}</span>
              {drafting && (
                <span className={waitingOn.has(player.id) ? "tag tag-active" : "tag"}>
                  {waitingOn.has(player.id) ? "Picking" : "Picked"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="muted">
        {playerConnections} {playerConnections === 1 ? "browser" : "browsers"} connected
      </p>
    </section>
  );
}

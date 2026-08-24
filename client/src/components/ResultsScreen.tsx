import { useState } from "react";
import type { DeckExport, LobbyStateView } from "@draft-simulator/shared";
import { CardImage } from "./CardImage.js";
import { HostSetupScreen } from "./HostSetupScreen.js";

interface ResultsScreenProps {
  lobbyState: LobbyStateView;
  myPlayerId: string;
  myDeckExport: DeckExport | null;
  onNewDraftCreated: (playerId: string) => void;
}

function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ResultsScreen({ lobbyState, myPlayerId, myDeckExport, onNewDraftCreated }: ResultsScreenProps) {
  const [copied, setCopied] = useState(false);
  const [showNewDraftForm, setShowNewDraftForm] = useState(false);
  const isHost = lobbyState.hostId === myPlayerId;

  return (
    <div className="screen">
      <h1>Draft complete!</h1>

      {myDeckExport ? (
        <>
          <h2>Your pool ({myDeckExport.cards.reduce((sum, c) => sum + c.count, 0)} cards)</h2>
          <div className="pool-grid">
            {myDeckExport.cards.map((c) => (
              <CardImage key={c.scryfallId} card={{ ...c, manaCost: "", cmc: 0, colors: [], typeLine: "", imageUrl: `/images/${c.scryfallId}` }} />
            ))}
          </div>

          <h2>Export</h2>
          <textarea className="export-text" readOnly value={myDeckExport.plainText} rows={12} />
          <div className="form-row">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(myDeckExport.plainText).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              {copied ? "Copied!" : "Copy to clipboard"}
            </button>
            <button
              type="button"
              onClick={() => downloadTextFile(`${myDeckExport.playerName}-deck.txt`, myDeckExport.plainText)}
            >
              Download .txt
            </button>
          </div>
        </>
      ) : (
        <p className="subtitle">Your personal export hasn't arrived yet — it should show up momentarily.</p>
      )}

      <h2>Players</h2>
      <ul className="player-list">
        {lobbyState.players.map((player) => (
          <li key={player.id}>
            {player.name}
            {player.id === myPlayerId && <span className="tag">you</span>}
          </li>
        ))}
      </ul>

      {isHost && (
        <div className="new-draft-section">
          {showNewDraftForm ? (
            <HostSetupScreen onCreated={onNewDraftCreated} />
          ) : (
            <button type="button" onClick={() => setShowNewDraftForm(true)}>
              Start a new draft
            </button>
          )}
        </div>
      )}
    </div>
  );
}

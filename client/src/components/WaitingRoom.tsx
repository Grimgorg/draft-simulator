import { useState } from "react";
import type { Card, LobbyStateView } from "@draft-simulator/shared";
import { socket } from "../socket.js";
import { CubePreviewModal } from "./CubePreviewModal.js";
import { SamplePackModal } from "./SamplePackModal.js";
import { UnresolvedCardsWarning } from "./UnresolvedCardsWarning.js";

// Like a pick's, so a lost acknowledgement can't leave the button loading until the page is reloaded.
const PREVIEW_ACK_TIMEOUT_MS = 10_000;
const NO_RESPONSE = "The server didn't respond. Please try again.";

interface CubeCards {
  cubeName: string;
  cards: Card[];
  unresolvedNames: string[];
}

interface WaitingRoomProps {
  lobbyState: LobbyStateView;
  myPlayerId: string;
}

export function WaitingRoom({ lobbyState, myPlayerId }: WaitingRoomProps) {
  const isSetDraft = lobbyState.settings?.setCode !== undefined;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Fetched once: a cube's cards don't change while the lobby waits.
  const [cubeCards, setCubeCards] = useState<CubeCards | null>(null);
  const [cubeOpen, setCubeOpen] = useState(false);
  const [samplePack, setSamplePack] = useState<Card[] | null>(null);
  const [samplePackOpen, setSamplePackOpen] = useState(false);

  function previewCube() {
    setError(null);
    if (cubeCards) {
      setCubeOpen(true);
      return;
    }
    setLoading(true);
    socket.timeout(PREVIEW_ACK_TIMEOUT_MS).emit("lobby:cubeCards", (err, result) => {
      setLoading(false);
      if (err) return setError(NO_RESPONSE);
      if (!result.ok) return setError(result.error);
      setCubeCards({ cubeName: result.cubeName, cards: result.cards, unresolvedNames: result.unresolvedNames });
      setCubeOpen(true);
    });
  }

  function openSamplePack() {
    setError(null);
    setSamplePackOpen(true);
    setLoading(true);
    socket.timeout(PREVIEW_ACK_TIMEOUT_MS).emit("lobby:samplePack", (err, result) => {
      setLoading(false);
      if (err) return setError(NO_RESPONSE);
      if (!result.ok) return setError(result.error);
      setSamplePack(result.cards);
    });
  }

  return (
    <div className="screen">
      <h1>{lobbyState.cubeName}</h1>
      <p className="subtitle">
        {lobbyState.cardCount} cards &middot; {lobbyState.settings?.packCount} packs of{" "}
        {lobbyState.settings?.packSize} &middot; {lobbyState.players.length}{" "}
        {lobbyState.players.length === 1 ? "player" : "players"}
      </p>
      <UnresolvedCardsWarning names={lobbyState.unresolvedCardNames ?? []} />

      <div className="preview-actions">
        {isSetDraft ? (
          <button type="button" onClick={openSamplePack} disabled={loading}>
            Open a sample pack
          </button>
        ) : (
          <button type="button" onClick={previewCube} disabled={loading}>
            {loading ? "Loading..." : "Preview cube"}
          </button>
        )}
      </div>
      {error && !samplePackOpen && <p className="error">{error}</p>}

      <ul className="player-list">
        {lobbyState.players.map((player) => (
          <li key={player.id}>
            <span className={`dot ${player.connected ? "dot-connected" : "dot-disconnected"}`} />
            {player.name}
            {player.id === myPlayerId && <span className="tag">you</span>}
          </li>
        ))}
      </ul>

      <p className="subtitle">Waiting for the host to start the draft...</p>

      {cubeOpen && cubeCards && (
        <CubePreviewModal
          cubeName={cubeCards.cubeName}
          cards={cubeCards.cards}
          unresolvedNames={cubeCards.unresolvedNames}
          onClose={() => setCubeOpen(false)}
        />
      )}
      {samplePackOpen && (
        <SamplePackModal
          setName={lobbyState.cubeName ?? ""}
          cards={samplePack}
          opening={loading}
          error={error}
          onOpenAnother={openSamplePack}
          onClose={() => {
            setSamplePackOpen(false);
            setError(null);
          }}
        />
      )}
    </div>
  );
}

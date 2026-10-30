import { useState } from "react";
import { MIN_PLAYERS, WINSTON_PLAYERS, type Card, type LobbyStateView } from "@draft-simulator/shared";
import { socket } from "../socket.js";
import { CloseDraftButton, LeaveDraftButton, ReleaseSeatMenu } from "./DraftControls.js";
import { CubePreviewModal } from "./CubePreviewModal.js";
import { SamplePackModal } from "./SamplePackModal.js";
import { UnresolvedCardsWarning } from "./UnresolvedCardsWarning.js";

// Like a pick's, so a lost acknowledgement can't leave the button loading until the page is reloaded.
const ACK_TIMEOUT_MS = 10_000;
const NO_RESPONSE = "The server didn't respond. Please try again.";

interface CubeCards {
  cubeName: string;
  cards: Card[];
  unresolvedNames: string[];
}

interface WaitingRoomProps {
  lobbyState: LobbyStateView;
  myPlayerId: string;
  /** Called once this browser's seat is gone: it left, or as the creator closed the draft. */
  onLeft: () => void;
}

export function WaitingRoom({ lobbyState, myPlayerId, onLeft }: WaitingRoomProps) {
  const isSetDraft = lobbyState.settings?.setCode !== undefined;
  const isWinston = lobbyState.settings?.format === "winston";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Fetched once: a cube's cards don't change while the lobby waits.
  const [cubeCards, setCubeCards] = useState<CubeCards | null>(null);
  const [cubeOpen, setCubeOpen] = useState(false);
  const [samplePack, setSamplePack] = useState<Card[] | null>(null);
  const [samplePackOpen, setSamplePackOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const isCreator = lobbyState.creatorPlayerId === myPlayerId;
  const creatorName = lobbyState.players.find((p) => p.id === lobbyState.creatorPlayerId)?.name ?? "its creator";
  const seated = lobbyState.players.length;
  const neededPlayers = isWinston ? WINSTON_PLAYERS : MIN_PLAYERS;
  const enoughPlayers = seated >= neededPlayers;

  function startDraft() {
    setStarting(true);
    setStartError(null);
    socket.timeout(ACK_TIMEOUT_MS).emit("draft:start", (err, result) => {
      setStarting(false);
      if (err) return setStartError(NO_RESPONSE);
      if (!result.ok) setStartError(result.error);
    });
  }

  function previewCube() {
    setError(null);
    if (cubeCards) {
      setCubeOpen(true);
      return;
    }
    setLoading(true);
    socket.timeout(ACK_TIMEOUT_MS).emit("lobby:cubeCards", (err, result) => {
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
    socket.timeout(ACK_TIMEOUT_MS).emit("lobby:samplePack", (err, result) => {
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
        {isWinston && <>Winston draft for {WINSTON_PLAYERS} &middot; </>}
        {lobbyState.cardCount} cards &middot; {lobbyState.settings?.packCount} packs of{" "}
        {lobbyState.settings?.packSize} &middot; {lobbyState.players.length}{" "}
        {lobbyState.players.length === 1 ? "player" : "players"}
      </p>
      {isWinston && (
        <p className="subtitle">
          Every player's packs are shuffled into one stack. Take turns choosing from three piles fed by it.
        </p>
      )}
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

      {isCreator ? (
        <div className="lobby-actions">
          <button type="button" disabled={!enoughPlayers || starting} onClick={startDraft}>
            {enoughPlayers
              ? "Start picking"
              : `Waiting for players (${seated} of ${isWinston ? "" : "at least "}${neededPlayers})`}
          </button>
          <CloseDraftButton status={lobbyState.status} onClosed={onLeft} />
          <ReleaseSeatMenu players={lobbyState.players} myPlayerId={myPlayerId} />
        </div>
      ) : (
        <>
          <p className="subtitle">Waiting for {creatorName} to start the draft...</p>
          <div className="lobby-actions">
            <LeaveDraftButton label="Leave draft" onLeft={onLeft} />
          </div>
        </>
      )}
      {startError && <p className="error">{startError}</p>}

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

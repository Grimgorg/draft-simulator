import { useState } from "react";
import type { Card } from "@draft-simulator/shared";
import { socket } from "../socket.js";
import { CubePreviewModal } from "./CubePreviewModal.js";

interface HostSetupScreenProps {
  onCreated: (playerId: string) => void;
}

interface CubePreviewData {
  cubeName: string;
  cards: Card[];
  unresolvedNames: string[];
}

export function HostSetupScreen({ onCreated }: HostSetupScreenProps) {
  const [hostName, setHostName] = useState("");
  const [cubeIdOrUrl, setCubeIdOrUrl] = useState("");
  const [packCount, setPackCount] = useState(3);
  const [packSize, setPackSize] = useState(15);
  const [playerCount, setPlayerCount] = useState(8);
  const [alternatingDraft, setAlternatingDraft] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<CubePreviewData | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    socket.emit(
      "lobby:create",
      { hostName, cubeIdOrUrl, packCount, packSize, playerCount, alternatingDraft },
      (result) => {
        setSubmitting(false);
        if (result.ok) {
          onCreated(result.playerId);
        } else {
          setError(result.error);
        }
      }
    );
  }

  function handlePreview() {
    setPreviewing(true);
    setPreviewError(null);

    socket.emit("cube:preview", { cubeIdOrUrl }, (result) => {
      setPreviewing(false);
      if (result.ok) {
        setPreviewData({ cubeName: result.cubeName, cards: result.cards, unresolvedNames: result.unresolvedNames });
      } else {
        setPreviewError(result.error);
      }
    });
  }

  return (
    <div className="screen">
      <h1>Draft Simulator</h1>
      <p className="subtitle">No draft is set up on this server yet. Set one up below to host it.</p>
      <form className="form" onSubmit={handleSubmit}>
        <label>
          Your name
          <input value={hostName} onChange={(e) => setHostName(e.target.value)} required autoFocus />
        </label>
        <label>
          CubeCobra cube URL or ID
          <div className="input-with-button">
            <input
              value={cubeIdOrUrl}
              onChange={(e) => setCubeIdOrUrl(e.target.value)}
              placeholder="https://cubecobra.com/cube/overview/..."
              required
            />
            <button type="button" onClick={handlePreview} disabled={!cubeIdOrUrl.trim() || previewing}>
              {previewing ? "Loading..." : "Preview cube"}
            </button>
          </div>
        </label>
        {previewError && <p className="error">{previewError}</p>}
        <div className="form-row">
          <label>
            Number of players
            <input
              type="number"
              min={2}
              value={playerCount}
              onChange={(e) => setPlayerCount(Number(e.target.value))}
              required
            />
          </label>
          <label>
            Packs per player
            <input
              type="number"
              min={1}
              value={packCount}
              onChange={(e) => setPackCount(Number(e.target.value))}
              required
            />
          </label>
          <label>
            Cards per pack
            <input
              type="number"
              min={1}
              value={packSize}
              onChange={(e) => setPackSize(Number(e.target.value))}
              required
            />
          </label>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={alternatingDraft}
            onChange={(e) => setAlternatingDraft(e.target.checked)}
          />
          Alternate pack direction each round
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Importing cube..." : "Create draft"}
        </button>
      </form>
      {previewData && (
        <CubePreviewModal
          cubeName={previewData.cubeName}
          cards={previewData.cards}
          unresolvedNames={previewData.unresolvedNames}
          onClose={() => setPreviewData(null)}
        />
      )}
    </div>
  );
}

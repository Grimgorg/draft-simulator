import { useState } from "react";
import type { Card } from "@draft-simulator/shared";
import { countCardCopies, formatDecklistText } from "@draft-simulator/shared";

interface DecklistExportProps {
  /** The cards currently in the main deck. */
  deckCards: Card[];
  pool: Card[];
  playerName: string;
}

type ExportMode = "deck" | "pool";

function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Shows the deck (or the whole pool) as a plain-text decklist, with a .txt download. */
export function DecklistExport({ deckCards, pool, playerName }: DecklistExportProps) {
  const [mode, setMode] = useState<ExportMode>("deck");
  const exportText = formatDecklistText(countCardCopies(mode === "deck" ? deckCards : pool));

  return (
    <>
      <h2>Export</h2>
      <div className="export-mode-row">
        <button type="button" className={mode === "deck" ? "active" : ""} onClick={() => setMode("deck")}>
          Deck ({deckCards.length})
        </button>
        <button type="button" className={mode === "pool" ? "active" : ""} onClick={() => setMode("pool")}>
          Whole pool ({pool.length})
        </button>
      </div>
      <textarea className="export-text" readOnly value={exportText} rows={12} />
      <div className="form-row">
        <button type="button" onClick={() => downloadTextFile(`${playerName}-${mode}.txt`, exportText)}>
          Download .txt
        </button>
      </div>
    </>
  );
}

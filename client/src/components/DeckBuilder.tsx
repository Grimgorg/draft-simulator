import { useEffect, useMemo, useRef, useState } from "react";
import type { Card } from "@draft-simulator/shared";
import { CardPile } from "./CardPile.js";

interface DeckBuilderProps {
  pool: Card[];
  basicLands: Card[];
  playerName: string;
}

interface Instance {
  id: string;
  card: Card;
}

interface Pile {
  id: number;
  /** Instance ids, bottom to top. */
  cards: string[];
}

interface DeckState {
  mainPiles: Pile[];
  /** A single stack, no sub-piles — everything not going in the deck. */
  cutPile: string[];
}

const DECK_TARGET = 40;

function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function buildExportText(cards: Card[]): string {
  const counts = new Map<string, { name: string; count: number }>();
  for (const card of cards) {
    const existing = counts.get(card.scryfallId);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(card.scryfallId, { name: card.name, count: 1 });
    }
  }
  return [...counts.values()].map((c) => `${c.count} ${c.name}`).join("\n");
}

export function DeckBuilder({ pool, basicLands, playerName }: DeckBuilderProps) {
  const [deck, setDeck] = useState<DeckState>({ mainPiles: [], cutPile: [] });
  const [addedBasics, setAddedBasics] = useState<Instance[]>([]);
  const [copied, setCopied] = useState(false);
  const [exportMode, setExportMode] = useState<"deck" | "pool">("deck");

  const nextPileId = useRef(0);
  const nextBasicId = useRef(0);
  const seenInstanceIds = useRef(new Set<string>());

  const poolInstances = useMemo<Instance[]>(() => pool.map((card, i) => ({ id: `pool:${i}`, card })), [pool]);
  const allInstances = useMemo(() => [...poolInstances, ...addedBasics], [poolInstances, addedBasics]);
  const instanceById = useMemo(() => new Map(allInstances.map((inst) => [inst.id, inst.card])), [allInstances]);

  // Every drafted card starts out as its own pile in the main deck — nothing
  // here disturbs piles the player already arranged. A newly-added basic
  // land instead joins whichever existing pile already holds a basic of the
  // same type, if any, so repeated "+ Mountain" clicks stack up rather than
  // scattering across the row.
  useEffect(() => {
    const fresh = allInstances.filter((inst) => !seenInstanceIds.current.has(inst.id));
    if (fresh.length === 0) return;
    fresh.forEach((inst) => seenInstanceIds.current.add(inst.id));
    setDeck((prev) => {
      let mainPiles = prev.mainPiles;
      const newPiles: Pile[] = [];
      for (const inst of fresh) {
        const existingPile = inst.id.startsWith("basic:")
          ? mainPiles.find((p) => p.cards.some((cardId) => cardId.startsWith(`basic:${inst.card.name}:`)))
          : undefined;
        if (existingPile) {
          mainPiles = mainPiles.map((p) => (p.id === existingPile.id ? { ...p, cards: [...p.cards, inst.id] } : p));
        } else {
          newPiles.push({ id: nextPileId.current++, cards: [inst.id] });
        }
      }
      return { ...prev, mainPiles: [...mainPiles, ...newPiles] };
    });
  }, [allInstances]);

  /** Removes `id` from wherever it currently sits, then hands the resulting
   * state to `place` to decide where (if anywhere) it lands. */
  function moveInstance(id: string, place: (withoutSource: DeckState) => DeckState) {
    setDeck((prev) => {
      const existed = prev.mainPiles.some((p) => p.cards.includes(id)) || prev.cutPile.includes(id);
      if (!existed) return prev;
      const withoutSource: DeckState = {
        mainPiles: prev.mainPiles.map((p) => ({ ...p, cards: p.cards.filter((c) => c !== id) })).filter((p) => p.cards.length > 0),
        cutPile: prev.cutPile.filter((c) => c !== id),
      };
      return place(withoutSource);
    });
  }

  /** Removes `id` outright, without placing it anywhere. */
  function removeInstance(id: string) {
    moveInstance(id, (withoutSource) => withoutSource);
  }

  function handleDropOnMainPile(id: string, targetPileId: number) {
    moveInstance(id, (state) => ({
      ...state,
      mainPiles: state.mainPiles.map((p) => (p.id === targetPileId ? { ...p, cards: [...p.cards, id] } : p)),
    }));
  }

  function handleDropOnMainBackground(e: React.DragEvent) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    moveInstance(id, (state) => ({ ...state, mainPiles: [...state.mainPiles, { id: nextPileId.current++, cards: [id] }] }));
  }

  function handleDropOnCutPile(id: string) {
    // Basic lands are synthesized locally, not drafted — dropping one on the
    // cut stack removes it outright instead of just parking it there, since
    // "not in deck" is a no-op for a card that isn't real inventory anyway.
    if (id.startsWith("basic:")) {
      removeInstance(id);
      setAddedBasics((prev) => prev.filter((inst) => inst.id !== id));
      return;
    }
    moveInstance(id, (state) => ({ ...state, cutPile: [...state.cutPile, id] }));
  }

  function handleDropOnCutBackground(e: React.DragEvent) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (id) handleDropOnCutPile(id);
  }

  function addBasic(land: Card) {
    setAddedBasics((prev) => [...prev, { id: `basic:${land.name}:${nextBasicId.current++}`, card: land }]);
  }

  const mainCards = deck.mainPiles.flatMap((p) => p.cards.map((id) => instanceById.get(id)!));
  const deckExportText = useMemo(() => buildExportText(mainCards), [mainCards]);
  const poolExportText = useMemo(() => buildExportText(pool), [pool]);
  const exportText = exportMode === "deck" ? deckExportText : poolExportText;
  const exportFilenameSuffix = exportMode === "deck" ? "deck" : "pool";

  return (
    <>
      <div className="deckbuilder">
        <div className="deck-pane">
          <div className="deck-pane-header">
            <h2>Deck</h2>
            <span className={`deck-count ${mainCards.length < DECK_TARGET ? "deck-count-warning" : ""}`}>
              {mainCards.length} / {DECK_TARGET} cards
            </span>
          </div>
          <div className="basic-land-row">
            {basicLands.map((land) => (
              <button key={land.scryfallId} type="button" onClick={() => addBasic(land)}>
                + {land.name}
              </button>
            ))}
          </div>
          <div className="pile-row" onDragOver={(e) => e.preventDefault()} onDrop={handleDropOnMainBackground}>
            {deck.mainPiles.map((pile) => (
              <CardPile
                key={pile.id}
                cards={pile.cards.map((id) => ({ id, card: instanceById.get(id)! }))}
                onDropCard={(id) => handleDropOnMainPile(id, pile.id)}
              />
            ))}
          </div>
        </div>

        <div className="cut-pane">
          <h2>Not in deck ({deck.cutPile.length})</h2>
          <div className="pile-row" onDragOver={(e) => e.preventDefault()} onDrop={handleDropOnCutBackground}>
            <CardPile cards={deck.cutPile.map((id) => ({ id, card: instanceById.get(id)! }))} onDropCard={handleDropOnCutPile} />
          </div>
        </div>
      </div>

      <h2>Export</h2>
      <div className="export-mode-row">
        <button
          type="button"
          className={exportMode === "deck" ? "active" : ""}
          onClick={() => setExportMode("deck")}
        >
          Deck ({mainCards.length})
        </button>
        <button
          type="button"
          className={exportMode === "pool" ? "active" : ""}
          onClick={() => setExportMode("pool")}
        >
          Whole pool ({pool.length})
        </button>
      </div>
      <textarea className="export-text" readOnly value={exportText} rows={12} />
      <div className="form-row">
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(exportText).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? "Copied!" : "Copy to clipboard"}
        </button>
        <button type="button" onClick={() => downloadTextFile(`${playerName}-${exportFilenameSuffix}.txt`, exportText)}>
          Download .txt
        </button>
      </div>
    </>
  );
}

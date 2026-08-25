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

  const nextPileId = useRef(0);
  const nextBasicId = useRef(0);
  const seenInstanceIds = useRef(new Set<string>());

  const poolInstances = useMemo<Instance[]>(() => pool.map((card, i) => ({ id: `pool:${i}`, card })), [pool]);
  const allInstances = useMemo(() => [...poolInstances, ...addedBasics], [poolInstances, addedBasics]);
  const instanceById = useMemo(() => new Map(allInstances.map((inst) => [inst.id, inst.card])), [allInstances]);

  // Every drafted card, and every newly-added basic land, starts out as its
  // own pile in the main deck — nothing here disturbs piles the player
  // already arranged.
  useEffect(() => {
    const fresh = allInstances.filter((inst) => !seenInstanceIds.current.has(inst.id));
    if (fresh.length === 0) return;
    fresh.forEach((inst) => seenInstanceIds.current.add(inst.id));
    setDeck((prev) => ({
      ...prev,
      mainPiles: [...prev.mainPiles, ...fresh.map((inst) => ({ id: nextPileId.current++, cards: [inst.id] }))],
    }));
  }, [allInstances]);

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
  const exportText = useMemo(() => buildExportText(mainCards), [mainCards]);

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
        <button type="button" onClick={() => downloadTextFile(`${playerName}-deck.txt`, exportText)}>
          Download .txt
        </button>
      </div>
    </>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import type { Card } from "@draft-simulator/shared";
import { countCardCopies, formatDecklistText } from "@draft-simulator/shared";
import {
  buildDeckStateKey,
  buildDraftPilesKey,
  getStoredDeckState,
  getStoredDraftPiles,
  storeDeckState,
} from "../pileStorage.js";
import { CardPile } from "./CardPile.js";

interface DeckBuilderProps {
  pool: Card[];
  basicLands: Card[];
  playerName: string;
  /** Together with `myPlayerId`, key this player's stored pile arrangement
   * for this draft session — undefined only if the session id somehow
   * isn't available yet, in which case nothing persists. */
  sessionId: string | undefined;
  myPlayerId: string;
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

interface ResolvedInitialDeckState {
  deck: DeckState;
  addedBasics: Instance[];
  nextPileId: number;
  nextBasicId: number;
  seenIds: Set<string>;
}

const EMPTY_RESOLVED_STATE: ResolvedInitialDeckState = {
  deck: { mainPiles: [], cutPile: [] },
  addedBasics: [],
  nextPileId: 0,
  nextBasicId: 0,
  seenIds: new Set(),
};

/**
 * Figures out what to seed the deck builder with, in priority order:
 * this player's own saved deck-builder state for this session (a refresh
 * while deck building), else the draft board's saved pile arrangement for
 * the same session (first arrival here right after the draft finished),
 * else nothing — the existing mount effect below then builds today's
 * default one-pile-per-card layout from `pool`.
 */
function resolveInitialDeckState(
  deckKey: string | null,
  draftKey: string | null,
  basicLands: Card[]
): ResolvedInitialDeckState {
  const own = deckKey ? getStoredDeckState(deckKey) : null;
  if (own) {
    const addedBasics: Instance[] = [];
    for (const stored of own.addedBasics) {
      const card = basicLands.find((land) => land.name === stored.cardName);
      if (card) addedBasics.push({ id: stored.id, card });
    }
    // A basic whose land no longer resolves (shouldn't normally happen)
    // is dropped from wherever it sits too, keeping restored state clean
    // (render also defends against an unresolved id via resolveInstances).
    const resolvableBasicIds = new Set(addedBasics.map((b) => b.id));
    const isResolvable = (id: string) => !id.startsWith("basic:") || resolvableBasicIds.has(id);

    const mainPiles = own.mainPiles
      .map((pile) => ({ ...pile, cards: pile.cards.filter(isResolvable) }))
      .filter((pile) => pile.cards.length > 0);
    const cutPile = own.cutPile.filter(isResolvable);

    return {
      deck: { mainPiles, cutPile },
      addedBasics,
      nextPileId: mainPiles.reduce((max, p) => Math.max(max, p.id + 1), 0),
      nextBasicId: addedBasics.reduce((max, b) => {
        const match = /:(\d+)$/.exec(b.id);
        return match ? Math.max(max, Number(match[1]) + 1) : max;
      }, 0),
      seenIds: new Set([...mainPiles.flatMap((p) => p.cards), ...cutPile]),
    };
  }

  const fromDraft = draftKey ? getStoredDraftPiles(draftKey) : null;
  if (fromDraft && fromDraft.length > 0) {
    const mainPiles: Pile[] = fromDraft.map((pile) => ({
      id: pile.id,
      cards: pile.cards.map((poolIndex) => `pool:${poolIndex}`),
    }));
    return {
      deck: { mainPiles, cutPile: [] },
      addedBasics: [],
      nextPileId: mainPiles.reduce((max, p) => Math.max(max, p.id + 1), 0),
      nextBasicId: 0,
      seenIds: new Set(mainPiles.flatMap((p) => p.cards)),
    };
  }

  return EMPTY_RESOLVED_STATE;
}

export function DeckBuilder({ pool, basicLands, playerName, sessionId, myPlayerId }: DeckBuilderProps) {
  const deckKey = sessionId ? buildDeckStateKey(sessionId, myPlayerId) : null;
  const draftKey = sessionId ? buildDraftPilesKey(sessionId, myPlayerId) : null;

  // Resolved exactly once at mount via React's lazy useState initializer,
  // since basicLands/keys don't change across this component's lifetime.
  const [initial] = useState<ResolvedInitialDeckState>(() =>
    resolveInitialDeckState(deckKey, draftKey, basicLands)
  );

  const [deck, setDeck] = useState<DeckState>(initial.deck);
  const [addedBasics, setAddedBasics] = useState<Instance[]>(initial.addedBasics);
  const [exportMode, setExportMode] = useState<"deck" | "pool">("deck");

  const nextPileId = useRef(initial.nextPileId);
  const nextBasicId = useRef(initial.nextBasicId);
  const seenInstanceIds = useRef(new Set<string>(initial.seenIds));

  const poolInstances = useMemo<Instance[]>(() => pool.map((card, i) => ({ id: `pool:${i}`, card })), [pool]);
  const allInstances = useMemo(() => [...poolInstances, ...addedBasics], [poolInstances, addedBasics]);
  const instanceById = useMemo(() => new Map(allInstances.map((inst) => [inst.id, inst.card])), [allInstances]);

  /** Looks up each id, dropping any that don't currently resolve to a card.
   * Piles restored from storage can briefly reference pool ids before the
   * `pool` prop (arriving over the socket after reconnect) has caught up —
   * this keeps render safe for that window rather than crashing, and
   * self-heals once `pool` arrives since piles/cutPile aren't re-derived,
   * only re-rendered. */
  function resolveInstances(ids: string[]): Instance[] {
    const resolved: Instance[] = [];
    for (const id of ids) {
      const card = instanceById.get(id);
      if (card) resolved.push({ id, card });
    }
    return resolved;
  }

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

  // Keeps the arrangement across a refresh while deck building.
  useEffect(() => {
    if (!deckKey) return;
    storeDeckState(deckKey, {
      mainPiles: deck.mainPiles,
      cutPile: deck.cutPile,
      addedBasics: addedBasics.map((inst) => ({ id: inst.id, cardName: inst.card.name })),
    });
  }, [deckKey, deck, addedBasics]);

  /** Moves a whole dragged run (an instance plus everything stacked on top
   * of it) from wherever it currently sits to wherever `place` decides to
   * put it. Piles emptied by the move are kept (not pre-filtered) until
   * after `place` runs, so dropping a run back onto its own now-empty
   * source pile still finds that pile to append to. */
  function moveInstances(ids: string[], place: (withoutSource: DeckState) => DeckState) {
    setDeck((prev) => {
      const idSet = new Set(ids);
      const existed = prev.mainPiles.some((p) => p.cards.some((c) => idSet.has(c))) || prev.cutPile.some((c) => idSet.has(c));
      if (!existed) return prev;
      const withoutSource: DeckState = {
        mainPiles: prev.mainPiles.map((p) => {
          const kept = p.cards.filter((c) => !idSet.has(c));
          return kept.length === p.cards.length ? p : { ...p, cards: kept };
        }),
        cutPile: prev.cutPile.filter((c) => !idSet.has(c)),
      };
      const result = place(withoutSource);
      return { ...result, mainPiles: result.mainPiles.filter((p) => p.cards.length > 0) };
    });
  }

  /** Removes every id in `ids` outright, without placing them anywhere. */
  function removeInstances(ids: string[]) {
    moveInstances(ids, (withoutSource) => withoutSource);
  }

  function handleDropOnMainPile(ids: string[], targetPileId: number) {
    moveInstances(ids, (state) => ({
      ...state,
      mainPiles: state.mainPiles.map((p) => (p.id === targetPileId ? { ...p, cards: [...p.cards, ...ids] } : p)),
    }));
  }

  function handleDropOnMainBackground(e: React.DragEvent) {
    e.preventDefault();
    const ids = e.dataTransfer.getData("text/plain").split(",").filter(Boolean);
    if (ids.length === 0) return;
    moveInstances(ids, (state) => ({ ...state, mainPiles: [...state.mainPiles, { id: nextPileId.current++, cards: ids }] }));
  }

  function handleDropOnCutPile(ids: string[]) {
    // Basic lands are synthesized locally, not drafted — dropping one on the
    // cut stack removes it outright instead of just parking it there, since
    // "not in deck" is a no-op for a card that isn't real inventory anyway.
    const basicIds = ids.filter((id) => id.startsWith("basic:"));
    const nonBasicIds = ids.filter((id) => !id.startsWith("basic:"));
    if (basicIds.length > 0) {
      removeInstances(basicIds);
      setAddedBasics((prev) => prev.filter((inst) => !basicIds.includes(inst.id)));
    }
    if (nonBasicIds.length > 0) {
      moveInstances(nonBasicIds, (state) => ({ ...state, cutPile: [...state.cutPile, ...nonBasicIds] }));
    }
  }

  function handleDropOnCutBackground(e: React.DragEvent) {
    e.preventDefault();
    const ids = e.dataTransfer.getData("text/plain").split(",").filter(Boolean);
    if (ids.length > 0) handleDropOnCutPile(ids);
  }

  function addBasic(land: Card) {
    setAddedBasics((prev) => [...prev, { id: `basic:${land.name}:${nextBasicId.current++}`, card: land }]);
  }

  const mainCards = deck.mainPiles.flatMap((p) => resolveInstances(p.cards).map((inst) => inst.card));
  const deckExportText = useMemo(() => formatDecklistText(countCardCopies(mainCards)), [mainCards]);
  const poolExportText = useMemo(() => formatDecklistText(countCardCopies(pool)), [pool]);
  const exportText = exportMode === "deck" ? deckExportText : poolExportText;
  const exportFilenameSuffix = exportMode === "deck" ? "deck" : "pool";

  return (
    <>
      <div className="deckbuilder">
        <div className="deckbuilder-header">
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
        </div>

        <h2>Not in deck ({deck.cutPile.length})</h2>

        <div className="deck-pane">
          <div className="pile-row" onDragOver={(e) => e.preventDefault()} onDrop={handleDropOnMainBackground}>
            {deck.mainPiles.map((pile) => (
              <CardPile
                key={pile.id}
                cards={resolveInstances(pile.cards)}
                onDropCard={(ids) => handleDropOnMainPile(ids, pile.id)}
              />
            ))}
          </div>
        </div>

        <div className="cut-pane">
          <div className="pile-row" onDragOver={(e) => e.preventDefault()} onDrop={handleDropOnCutBackground}>
            <CardPile cards={resolveInstances(deck.cutPile)} onDropCard={handleDropOnCutPile} />
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
        <button type="button" onClick={() => downloadTextFile(`${playerName}-${exportFilenameSuffix}.txt`, exportText)}>
          Download .txt
        </button>
      </div>
    </>
  );
}

import { useEffect, useState } from "react";
import type { Card, CardInstance, MatchStateView, PlayerBoardView, Zone } from "@draft-simulator/shared";
import { socket } from "../socket.js";
import { CardImage } from "./CardImage.js";

interface MatchBoardProps {
  matchState: MatchStateView;
}

function CardInstanceImage({ instance }: { instance: CardInstance }) {
  if (instance.tokenLabel) return <div className="card match-token">{instance.tokenLabel}</div>;
  // A null card (and no token label) means a face-down card as seen by its non-owner.
  if (!instance.card) return <div className="card match-face-down" />;
  return <CardImage card={instance.card} />;
}

function handleDragStart(e: React.DragEvent, instanceId: string) {
  e.dataTransfer.setData("text/plain", instanceId);
  e.dataTransfer.effectAllowed = "move";
}

interface ZoneRowProps {
  label: string;
  cards: CardInstance[];
  draggable: boolean;
  onDropCard?: (instanceId: string) => void;
}

function ZoneRow({ label, cards, draggable, onDropCard }: ZoneRowProps) {
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (id) onDropCard?.(id);
  }

  return (
    <div className="match-zone" onDragOver={onDropCard ? (e) => e.preventDefault() : undefined} onDrop={onDropCard ? handleDrop : undefined}>
      <div className="match-zone-label">
        {label} ({cards.length})
      </div>
      <div className="match-zone-cards">
        {cards.map((c) => (
          <div
            key={c.instanceId}
            className="match-zone-card"
            draggable={draggable}
            onDragStart={draggable ? (e) => handleDragStart(e, c.instanceId) : undefined}
          >
            <CardInstanceImage instance={c} />
          </div>
        ))}
      </div>
    </div>
  );
}

interface BattlefieldActions {
  onDropCard: (instanceId: string, row: number, stackId?: string) => void;
  onSetSlot: (instanceId: string, row: number, stackId?: string) => void;
  onTapToggle: (instanceId: string, tapped: boolean) => void;
  onCounterChange: (instanceId: string, label: string, delta: number) => void;
  onFlip: (instanceId: string, faceDown: boolean) => void;
}

/** Vertical offset between stacked battlefield cards — mirrors CardPile's peek-stack technique, sized for the battlefield's narrower 90px cards. */
const BATTLEFIELD_PEEK_HEIGHT = 20;
/** Matches `.battlefield-stack`'s fixed width at Magic's card aspect ratio. */
const BATTLEFIELD_CARD_HEIGHT = 126;

function BattlefieldCard({ instance, actions }: { instance: CardInstance; actions?: BattlefieldActions }) {
  const [expanded, setExpanded] = useState(false);
  const [counterLabel, setCounterLabel] = useState("");
  const mine = actions !== undefined;
  const counters = Object.entries(instance.counters ?? {});

  return (
    <div
      className="battlefield-card"
      draggable={mine}
      onDragStart={mine ? (e) => handleDragStart(e, instance.instanceId) : undefined}
    >
      <div className="battlefield-card-art">
        <div
          className={`battlefield-card-inner ${instance.tapped ? "tapped" : ""}`}
          onClick={mine ? () => actions!.onTapToggle(instance.instanceId, !instance.tapped) : undefined}
        >
          <CardInstanceImage instance={instance} />
        </div>
        {counters.length > 0 && (
          <div className="battlefield-counters">
            {counters.map(([label, value]) => (
              <span key={label} className="tag">
                {label}: {value}
              </span>
            ))}
          </div>
        )}
        {mine && (
          <button type="button" className="battlefield-card-toggle" onClick={() => setExpanded((v) => !v)}>
            ⚙
          </button>
        )}
        {mine && expanded && (
          <div className="battlefield-card-panel">
            <div className="battlefield-card-panel-row">
              <span className="tag">+1/+1</span>
              <button type="button" onClick={() => actions!.onCounterChange(instance.instanceId, "+1/+1", 1)}>
                +
              </button>
              <button type="button" onClick={() => actions!.onCounterChange(instance.instanceId, "+1/+1", -1)}>
                -
              </button>
            </div>
            <div className="battlefield-card-panel-row">
              <span className="tag">Charge</span>
              <button type="button" onClick={() => actions!.onCounterChange(instance.instanceId, "charge", 1)}>
                +
              </button>
              <button type="button" onClick={() => actions!.onCounterChange(instance.instanceId, "charge", -1)}>
                -
              </button>
            </div>
            <div className="battlefield-card-panel-row">
              <input
                className="counter-label-input"
                placeholder="custom counter"
                value={counterLabel}
                onChange={(e) => setCounterLabel(e.target.value)}
              />
              <button
                type="button"
                disabled={!counterLabel.trim()}
                onClick={() => actions!.onCounterChange(instance.instanceId, counterLabel.trim(), 1)}
              >
                +
              </button>
              <button
                type="button"
                disabled={!counterLabel.trim()}
                onClick={() => actions!.onCounterChange(instance.instanceId, counterLabel.trim(), -1)}
              >
                -
              </button>
            </div>
            <button type="button" onClick={() => actions!.onFlip(instance.instanceId, !instance.faceDown)}>
              {instance.faceDown ? "Flip up" : "Flip down"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Groups `cards` (already filtered to one row) into left-to-right stacks: cards sharing a stackId form one pile, ordered bottom to top by their order of appearance. Stacks themselves are ordered by each one's first appearance. */
function groupBattlefieldStacks(cards: CardInstance[]): CardInstance[][] {
  const order: string[] = [];
  const groups = new Map<string, CardInstance[]>();
  for (const card of cards) {
    const key = card.stackId ?? card.instanceId;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(card);
  }
  return order.map((key) => groups.get(key)!);
}

function BattlefieldStack({
  cards,
  row,
  actions,
  isAlreadyOnBattlefield,
}: {
  cards: CardInstance[];
  row: number;
  actions?: BattlefieldActions;
  isAlreadyOnBattlefield: (instanceId: string) => boolean;
}) {
  const stackId = cards[0]!.stackId ?? cards[0]!.instanceId;
  const topIndex = cards.length - 1;

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData("text/plain");
    if (!id || !actions) return;
    if (isAlreadyOnBattlefield(id)) actions.onSetSlot(id, row, stackId);
    else actions.onDropCard(id, row, stackId);
  }

  return (
    <div
      className="battlefield-stack"
      style={{ height: topIndex * BATTLEFIELD_PEEK_HEIGHT + BATTLEFIELD_CARD_HEIGHT }}
      onDragOver={actions ? (e) => e.preventDefault() : undefined}
      onDrop={actions ? handleDrop : undefined}
    >
      {cards.map((c, i) => (
        <div key={c.instanceId} className="battlefield-stack-card" style={{ top: i * BATTLEFIELD_PEEK_HEIGHT, zIndex: i }}>
          <BattlefieldCard instance={c} actions={actions} />
        </div>
      ))}
    </div>
  );
}

function BattlefieldRow({
  row,
  cards,
  actions,
  isAlreadyOnBattlefield,
}: {
  row: number;
  cards: CardInstance[];
  actions?: BattlefieldActions;
  isAlreadyOnBattlefield: (instanceId: string) => boolean;
}) {
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (!id || !actions) return;
    if (isAlreadyOnBattlefield(id)) actions.onSetSlot(id, row);
    else actions.onDropCard(id, row);
  }

  const stacks = groupBattlefieldStacks(cards);

  return (
    <div className="battlefield-row" onDragOver={actions ? (e) => e.preventDefault() : undefined} onDrop={actions ? handleDrop : undefined}>
      {stacks.map((stack) => (
        <BattlefieldStack key={stack[0]!.stackId ?? stack[0]!.instanceId} cards={stack} row={row} actions={actions} isAlreadyOnBattlefield={isAlreadyOnBattlefield} />
      ))}
    </div>
  );
}

function Battlefield({ cards, order, actions }: { cards: CardInstance[]; order: "battlefield-first" | "battlefield-last"; actions?: BattlefieldActions }) {
  const isAlreadyOnBattlefield = (instanceId: string) => cards.some((c) => c.instanceId === instanceId);
  const row0 = cards.filter((c) => (c.row ?? 0) === 0);
  const row1 = cards.filter((c) => (c.row ?? 0) === 1);
  // Row 0 always sits nearest the shared center strip between the two battlefields.
  const rows =
    order === "battlefield-first"
      ? [
          { row: 0, cards: row0 },
          { row: 1, cards: row1 },
        ]
      : [
          { row: 1, cards: row1 },
          { row: 0, cards: row0 },
        ];

  return (
    <div className="match-zone">
      <div className="match-zone-label">Battlefield ({cards.length})</div>
      <div className="battlefield-surface">
        {rows.map(({ row, cards: rowCards }) => (
          <BattlefieldRow key={row} row={row} cards={rowCards} actions={actions} isAlreadyOnBattlefield={isAlreadyOnBattlefield} />
        ))}
      </div>
    </div>
  );
}

interface LibraryControlsProps {
  count: number;
  onDraw: () => void;
  onShuffle: () => void;
  onMulligan: () => void;
  onDropToLibrary: (instanceId: string, position: "top" | "bottom") => void;
  onPeek: (count: number) => void;
}

function LibraryControls({ count, onDraw, onShuffle, onMulligan, onDropToLibrary, onPeek }: LibraryControlsProps) {
  const [peekCount, setPeekCount] = useState(3);

  function dropHandlers(position: "top" | "bottom") {
    return {
      onDragOver: (e: React.DragEvent) => e.preventDefault(),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDropToLibrary(id, position);
      },
    };
  }

  return (
    <div className="match-library-controls">
      <span className="tag">Library ({count})</span>
      <div className="library-drop-zone" {...dropHandlers("top")}>
        Drop: top
      </div>
      <div className="library-drop-zone" {...dropHandlers("bottom")}>
        Drop: bottom
      </div>
      <button type="button" onClick={onDraw}>
        Draw
      </button>
      <button type="button" onClick={onShuffle}>
        Shuffle
      </button>
      <button type="button" onClick={onMulligan}>
        Mulligan
      </button>
      <input
        type="number"
        min={1}
        className="peek-count-input"
        value={peekCount}
        onChange={(e) => setPeekCount(Math.max(1, Number(e.target.value)))}
      />
      <button type="button" onClick={() => onPeek(peekCount)}>
        Look
      </button>
      <button type="button" onClick={() => onPeek(count)} disabled={count === 0}>
        Search all
      </button>
    </div>
  );
}

function TokenControls({ onCreateToken }: { onCreateToken: (label: string) => void }) {
  const [label, setLabel] = useState("1/1 Soldier");

  return (
    <div className="token-controls">
      <input className="token-label-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Token name" />
      <button type="button" onClick={() => label.trim() && onCreateToken(label.trim())}>
        Create token
      </button>
    </div>
  );
}

function PlayerCounters({ counters, onChange }: { counters: Record<string, number>; onChange?: (label: string, delta: number) => void }) {
  const [label, setLabel] = useState("poison");
  const extraCounters = Object.entries(counters).filter(([key]) => key !== "life");

  return (
    <div className="player-counters">
      {onChange && (
        <button type="button" onClick={() => onChange("life", -1)}>
          -
        </button>
      )}
      <span className="tag">Life {counters["life"] ?? 0}</span>
      {onChange && (
        <button type="button" onClick={() => onChange("life", 1)}>
          +
        </button>
      )}
      {extraCounters.map(([key, value]) => (
        <span key={key} className="tag">
          {key}: {value}
        </span>
      ))}
      {onChange && (
        <>
          <input className="counter-label-input" value={label} onChange={(e) => setLabel(e.target.value)} />
          <button type="button" onClick={() => onChange(label, 1)}>
            +
          </button>
          <button type="button" onClick={() => onChange(label, -1)}>
            -
          </button>
        </>
      )}
    </div>
  );
}

interface PeekModalProps {
  cards: CardInstance[];
  onMoveCard: (instanceId: string, toZone: Zone, toLibraryPosition?: "top" | "bottom") => void;
  onReveal: (instanceId: string) => void;
  onClose: () => void;
}

function PeekModal({ cards, onMoveCard, onReveal, onClose }: PeekModalProps) {
  return (
    <div className="peek-modal-backdrop">
      <div className="peek-modal">
        <div className="peek-modal-header">
          <h3>
            Looking at {cards.length} card{cards.length === 1 ? "" : "s"} (top of library first)
          </h3>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="peek-modal-cards">
          {cards.map((c) => (
            <div key={c.instanceId} className="peek-modal-card">
              <CardInstanceImage instance={c} />
              <div className="peek-modal-card-actions">
                <button type="button" onClick={() => onMoveCard(c.instanceId, "hand")}>
                  Hand
                </button>
                <button type="button" onClick={() => onMoveCard(c.instanceId, "battlefield")}>
                  Battlefield
                </button>
                <button type="button" onClick={() => onMoveCard(c.instanceId, "graveyard")}>
                  Graveyard
                </button>
                <button type="button" onClick={() => onMoveCard(c.instanceId, "exile")}>
                  Exile
                </button>
                <button type="button" onClick={() => onMoveCard(c.instanceId, "library", "bottom")}>
                  Bottom
                </button>
                <button type="button" onClick={() => onReveal(c.instanceId)}>
                  Reveal
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface PlayerActions {
  onMoveCard: (
    instanceId: string,
    toZone: Zone,
    toLibraryPosition?: "top" | "bottom",
    battlefieldTarget?: { row: number; stackId?: string }
  ) => void;
  onDraw: () => void;
  onShuffle: () => void;
  onMulligan: () => void;
  onSetBattlefieldSlot: (instanceId: string, row: number, stackId?: string) => void;
  onTapCard: (instanceId: string, tapped: boolean) => void;
  onUntapAll: () => void;
  onSetCardCounter: (instanceId: string, label: string, delta: number) => void;
  onFlipFaceDown: (instanceId: string, faceDown: boolean) => void;
  onCreateToken: (label: string) => void;
  onSetPlayerCounter: (label: string, delta: number) => void;
  onPeek: (count: number) => void;
}

interface PlayerControlsProps {
  name: string;
  counters: Record<string, number>;
  libraryCount: number;
  actions?: PlayerActions;
}

function PlayerControls({ name, counters, libraryCount, actions }: PlayerControlsProps) {
  return (
    <div className="match-center-half">
      <h2>{name}</h2>
      <PlayerCounters counters={counters} onChange={actions?.onSetPlayerCounter} />
      {actions && (
        <button type="button" onClick={actions.onUntapAll}>
          Untap all
        </button>
      )}
      {actions && <TokenControls onCreateToken={actions.onCreateToken} />}
      {actions ? (
        <LibraryControls
          count={libraryCount}
          onDraw={actions.onDraw}
          onShuffle={actions.onShuffle}
          onMulligan={actions.onMulligan}
          onDropToLibrary={(instanceId, position) => actions.onMoveCard(instanceId, "library", position)}
          onPeek={actions.onPeek}
        />
      ) : (
        <span className="tag">Library ({libraryCount})</span>
      )}
    </div>
  );
}

interface PlayerZoneStackProps {
  board: PlayerBoardView;
  revealHand: boolean;
  order: "battlefield-first" | "battlefield-last";
  actions?: PlayerActions;
}

function PlayerZoneStack({ board, revealHand, order, actions }: PlayerZoneStackProps) {
  const mine = actions !== undefined;
  const dropTo = (zone: Zone) => (actions ? (instanceId: string) => actions.onMoveCard(instanceId, zone) : undefined);
  const battlefieldActions: BattlefieldActions | undefined = actions && {
    onDropCard: (instanceId, row, stackId) => actions.onMoveCard(instanceId, "battlefield", undefined, { row, stackId }),
    onSetSlot: actions.onSetBattlefieldSlot,
    onTapToggle: actions.onTapCard,
    onCounterChange: actions.onSetCardCounter,
    onFlip: actions.onFlipFaceDown,
  };

  const battlefield = <Battlefield cards={board.battlefield} order={order} actions={battlefieldActions} />;
  const otherZones = (
    <>
      {revealHand && board.hand.cards ? (
        <ZoneRow label="Hand" cards={board.hand.cards} draggable={mine} onDropCard={dropTo("hand")} />
      ) : (
        <div className="match-zone">
          <div className="match-zone-label">Hand ({board.hand.count})</div>
        </div>
      )}
      <div className="match-zone-pair">
        <ZoneRow label="Graveyard" cards={board.graveyard} draggable={mine} onDropCard={dropTo("graveyard")} />
        <ZoneRow label="Exile" cards={board.exile} draggable={mine} onDropCard={dropTo("exile")} />
      </div>
    </>
  );

  return (
    <div className="player-zone-stack">
      {order === "battlefield-first" ? (
        <>
          {battlefield}
          {otherZones}
        </>
      ) : (
        <>
          {otherZones}
          {battlefield}
        </>
      )}
    </div>
  );
}

function DiceControls({ onRoll }: { onRoll: (sides: number) => void }) {
  const [sides, setSides] = useState(20);
  return (
    <div className="dice-controls">
      <input type="number" min={2} className="dice-sides-input" value={sides} onChange={(e) => setSides(Math.max(2, Number(e.target.value)))} />
      <button type="button" onClick={() => onRoll(sides)}>
        Roll die
      </button>
      <button type="button" onClick={() => onRoll(2)}>
        Flip coin
      </button>
    </div>
  );
}

export function MatchBoard({ matchState }: MatchBoardProps) {
  const [conceding, setConceding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peekedCards, setPeekedCards] = useState<CardInstance[] | null>(null);
  const [eventLog, setEventLog] = useState<string | null>(null);

  useEffect(() => {
    function onRevealed(payload: { fromPlayerId: string; fromName: string; card: Card | null; tokenLabel?: string }) {
      const name = payload.tokenLabel ?? payload.card?.name ?? "a card";
      setEventLog(`${payload.fromName} revealed: ${name}`);
    }
    function onDiceResult(payload: { fromPlayerId: string; fromName: string; sides: number; result: number }) {
      const label = payload.sides === 2 ? (payload.result === 1 ? "Heads" : "Tails") : `${payload.result} (d${payload.sides})`;
      setEventLog(`${payload.fromName} rolled: ${label}`);
    }
    socket.on("match:revealed", onRevealed);
    socket.on("match:diceResult", onDiceResult);
    return () => {
      socket.off("match:revealed", onRevealed);
      socket.off("match:diceResult", onDiceResult);
    };
  }, []);

  function report(result: { ok: true } | { ok: false; error: string }) {
    setError(result.ok ? null : result.error);
  }

  function handleConcede() {
    setConceding(true);
    setError(null);
    socket.emit("match:concede", (result) => {
      setConceding(false);
      report(result);
    });
  }

  function handleMoveCard(
    instanceId: string,
    toZone: Zone,
    toLibraryPosition?: "top" | "bottom",
    battlefieldTarget?: { row: number; stackId?: string }
  ) {
    socket.emit(
      "match:moveCard",
      { instanceId, toZone, toLibraryPosition, battlefieldRow: battlefieldTarget?.row, battlefieldStackId: battlefieldTarget?.stackId },
      report
    );
  }

  function handleDraw() {
    socket.emit("match:drawCard", report);
  }

  function handleShuffle() {
    socket.emit("match:shuffleLibrary", report);
  }

  function handleMulligan() {
    socket.emit("match:mulligan", report);
  }

  function handleSetBattlefieldSlot(instanceId: string, row: number, stackId?: string) {
    socket.emit("match:setBattlefieldSlot", { instanceId, row, stackId }, report);
  }

  function handleTapCard(instanceId: string, tapped: boolean) {
    socket.emit("match:tapCard", { instanceId, tapped }, report);
  }

  function handleUntapAll() {
    socket.emit("match:untapAll", report);
  }

  function handleSetCardCounter(instanceId: string, label: string, delta: number) {
    socket.emit("match:setCardCounter", { instanceId, label, delta }, report);
  }

  function handleFlipFaceDown(instanceId: string, faceDown: boolean) {
    socket.emit("match:flipFaceDown", { instanceId, faceDown }, report);
  }

  function handleCreateToken(label: string) {
    socket.emit("match:createToken", { label }, report);
  }

  function handleSetPlayerCounter(label: string, delta: number) {
    socket.emit("match:setPlayerCounter", { label, delta }, report);
  }

  function handleRollDie(sides: number) {
    socket.emit("match:rollDie", { sides }, report);
  }

  function handlePeek(count: number) {
    setError(null);
    socket.emit("match:peekLibrary", { count }, (result) => {
      if (result.ok) setPeekedCards(result.cards);
      else setError(result.error);
    });
  }

  function handlePeekMoveCard(instanceId: string, toZone: Zone, toLibraryPosition?: "top" | "bottom") {
    socket.emit("match:moveCard", { instanceId, toZone, toLibraryPosition }, (result) => {
      report(result);
      if (result.ok) setPeekedCards((prev) => prev?.filter((c) => c.instanceId !== instanceId) ?? null);
    });
  }

  function handleRevealCard(instanceId: string) {
    socket.emit("match:revealCard", { instanceId }, report);
  }

  const myActions: PlayerActions = {
    onMoveCard: handleMoveCard,
    onDraw: handleDraw,
    onShuffle: handleShuffle,
    onMulligan: handleMulligan,
    onSetBattlefieldSlot: handleSetBattlefieldSlot,
    onTapCard: handleTapCard,
    onUntapAll: handleUntapAll,
    onSetCardCounter: handleSetCardCounter,
    onFlipFaceDown: handleFlipFaceDown,
    onCreateToken: handleCreateToken,
    onSetPlayerCounter: handleSetPlayerCounter,
    onPeek: handlePeek,
  };

  return (
    <div className="screen match-board">
      <PlayerZoneStack board={matchState.opponent} revealHand={false} order="battlefield-last" />
      <div className="match-center-row">
        <PlayerControls
          name={matchState.opponentName}
          counters={matchState.opponent.counters}
          libraryCount={matchState.opponent.library.count}
        />
        <div className="match-center-divider" />
        <PlayerControls name="You" counters={matchState.me.counters} libraryCount={matchState.me.library.count} actions={myActions} />
      </div>
      <PlayerZoneStack board={matchState.me} revealHand order="battlefield-first" actions={myActions} />
      {eventLog && <p className="subtitle">{eventLog}</p>}
      {error && <p className="error">{error}</p>}
      <div className="match-bottom-row">
        <DiceControls onRoll={handleRollDie} />
        <button type="button" className="cancel-draft-button" onClick={handleConcede} disabled={conceding}>
          {conceding ? "..." : "Concede"}
        </button>
      </div>
      {peekedCards && (
        <PeekModal
          cards={peekedCards}
          onMoveCard={handlePeekMoveCard}
          onReveal={handleRevealCard}
          onClose={() => setPeekedCards(null)}
        />
      )}
    </div>
  );
}

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
  onDropCard: (instanceId: string) => void;
  onReposition: (instanceId: string, x: number, y: number) => void;
  onTapToggle: (instanceId: string, tapped: boolean) => void;
  onCounterChange: (instanceId: string, label: string, delta: number) => void;
  onFlip: (instanceId: string, faceDown: boolean) => void;
}

function BattlefieldCard({ instance, actions }: { instance: CardInstance; actions?: BattlefieldActions }) {
  const [counterLabel, setCounterLabel] = useState("+1/+1");
  const mine = actions !== undefined;
  const counters = Object.entries(instance.counters ?? {});

  return (
    <div
      className="battlefield-card"
      style={{ left: instance.x ?? 0, top: instance.y ?? 0 }}
      draggable={mine}
      onDragStart={mine ? (e) => handleDragStart(e, instance.instanceId) : undefined}
    >
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
        <div className="battlefield-card-controls">
          <input
            className="counter-label-input"
            value={counterLabel}
            onChange={(e) => setCounterLabel(e.target.value)}
          />
          <button type="button" onClick={() => actions!.onCounterChange(instance.instanceId, counterLabel, 1)}>
            +
          </button>
          <button type="button" onClick={() => actions!.onCounterChange(instance.instanceId, counterLabel, -1)}>
            -
          </button>
          <button type="button" onClick={() => actions!.onFlip(instance.instanceId, !instance.faceDown)}>
            {instance.faceDown ? "Flip up" : "Flip down"}
          </button>
        </div>
      )}
    </div>
  );
}

function Battlefield({ cards, actions }: { cards: CardInstance[]; actions?: BattlefieldActions }) {
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (!id || !actions) return;
    const alreadyHere = cards.some((c) => c.instanceId === id);
    if (alreadyHere) {
      const rect = e.currentTarget.getBoundingClientRect();
      actions.onReposition(id, e.clientX - rect.left, e.clientY - rect.top);
    } else {
      actions.onDropCard(id);
    }
  }

  return (
    <div className="match-zone">
      <div className="match-zone-label">Battlefield ({cards.length})</div>
      <div className="battlefield-surface" onDragOver={actions ? (e) => e.preventDefault() : undefined} onDrop={actions ? handleDrop : undefined}>
        {cards.map((c) => (
          <BattlefieldCard key={c.instanceId} instance={c} actions={actions} />
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
  onMoveCard: (instanceId: string, toZone: Zone, toLibraryPosition?: "top" | "bottom") => void;
  onDraw: () => void;
  onShuffle: () => void;
  onMulligan: () => void;
  onSetBattlefieldPosition: (instanceId: string, x: number, y: number) => void;
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
    onDropCard: dropTo("battlefield")!,
    onReposition: actions.onSetBattlefieldPosition,
    onTapToggle: actions.onTapCard,
    onCounterChange: actions.onSetCardCounter,
    onFlip: actions.onFlipFaceDown,
  };

  const battlefield = <Battlefield cards={board.battlefield} actions={battlefieldActions} />;
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

  function handleMoveCard(instanceId: string, toZone: Zone, toLibraryPosition?: "top" | "bottom") {
    socket.emit("match:moveCard", { instanceId, toZone, toLibraryPosition }, report);
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

  function handleSetBattlefieldPosition(instanceId: string, x: number, y: number) {
    socket.emit("match:setBattlefieldPosition", { instanceId, x, y }, report);
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
    onSetBattlefieldPosition: handleSetBattlefieldPosition,
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

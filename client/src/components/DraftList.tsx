import { useState } from "react";
import { WINSTON_PLAYERS, type DraftStatus, type DraftSummary } from "@draft-simulator/shared";
import type { StoredSeat } from "../playerIdentity.js";
import { CreateDraftModal } from "./CreateDraftModal.js";

interface DraftListProps {
  drafts: DraftSummary[];
  /** Opens a draft's join and rejoin screen. */
  onOpen: (draftId: string) => void;
  onCreated: (seat: StoredSeat) => void;
}

const STATUS_LABELS: Record<DraftStatus, string> = {
  lobby: "Waiting for players",
  drafting: "Drafting",
  complete: "Finished",
};

function describe(draft: DraftSummary): string {
  const { settings } = draft;
  const format = settings.format === "winston" ? `Winston draft for ${WINSTON_PLAYERS}` : "Draft";
  const source = settings.setCode !== undefined ? "set" : "cube";
  return `${format} · ${source} of ${draft.cardCount} cards · ${settings.packCount} packs of ${settings.packSize}`;
}

/** The page every browser that isn't seated sees: the server's drafts, to join one or create another. */
export function DraftList({ drafts, onOpen, onCreated }: DraftListProps) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="screen">
      <div className="draft-list-header">
        <h1>Drafts</h1>
        <button type="button" onClick={() => setCreating(true)}>
          Create draft
        </button>
      </div>

      {drafts.length === 0 ? (
        <p className="subtitle">No drafts yet. Create one, then send the link to your friends.</p>
      ) : (
        <ul className="draft-list">
          {drafts.map((draft) => {
            const creator = draft.players.find((p) => p.id === draft.creatorPlayerId);
            return (
              <li key={draft.draftId} className="draft-list-item">
                <div className="draft-list-info">
                  <h2>{draft.cubeName}</h2>
                  <p className="subtitle">{describe(draft)}</p>
                  <p className="subtitle">
                    <span className={`tag draft-status-${draft.status}`}>{STATUS_LABELS[draft.status]}</span>{" "}
                    {draft.players.length === 0
                      ? "No players yet"
                      : draft.players.map((p) => p.name).join(", ")}
                    {creator && <> &middot; created by {creator.name}</>}
                  </p>
                </div>
                <button type="button" onClick={() => onOpen(draft.draftId)}>
                  {draft.status === "lobby" ? "Join" : "Rejoin"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {creating && <CreateDraftModal onCreated={onCreated} onClose={() => setCreating(false)} />}
    </div>
  );
}

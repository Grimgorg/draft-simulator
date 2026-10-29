import { useEffect, useState, type ReactNode } from "react";
import { DRAFTABLE_SETS, WINSTON_PLAYERS, type DraftSettings, type NewDraftSettings } from "@draft-simulator/shared";
import { managementSocket } from "../managementSocket.js";
import { useManagementAction } from "../useManagementAction.js";
import { CardStackImage, CubeImage, NormalDraftImage, WinstonDraftImage } from "./DraftTypeImages.js";

interface CreateDraftModalProps {
  /** The settings to start from: the finished draft's, when there is one. */
  previousSettings?: DraftSettings;
  onClose: () => void;
}

/** How the draft is played: packs passed around the table, or Winston's piles. */
type DraftFormat = "normal" | "winston";
/** Where the cards come from. */
type DraftType = "cube" | "set";

/** What the form edits: both a cube and a set, so going back to the other type keeps what was typed. */
interface DraftForm {
  cubeIdOrUrl: string;
  setCode: string;
  packCount: number;
  packSize: number;
  alternatingDraft: boolean;
}

const DEFAULT_FORM: DraftForm = {
  cubeIdOrUrl: "",
  setCode: DRAFTABLE_SETS[0]!.code,
  packCount: 3,
  packSize: 15,
  alternatingDraft: true,
};

function initialForm(previous: DraftSettings | undefined): DraftForm {
  if (!previous) return DEFAULT_FORM;
  const { packCount, alternatingDraft } = previous;
  // A set's pack size is the set's own; a later cube draft starts from the default instead.
  if (previous.setCode !== undefined) return { ...DEFAULT_FORM, setCode: previous.setCode, packCount, alternatingDraft };
  return { ...DEFAULT_FORM, cubeIdOrUrl: previous.cubeId ?? "", packCount, packSize: previous.packSize, alternatingDraft };
}

function toNewDraftSettings(format: DraftFormat, type: DraftType, form: DraftForm): NewDraftSettings {
  const { packCount, packSize, alternatingDraft } = form;
  const source = type === "cube" ? { cubeIdOrUrl: form.cubeIdOrUrl } : { setCode: form.setCode };
  return { ...(format === "winston" ? { format } : {}), ...source, packCount, packSize, alternatingDraft };
}

interface DraftTypeOptionProps {
  label: string;
  image: ReactNode;
  autoFocus?: boolean;
  onChoose: () => void;
}

/** An image-only button with its label below it. */
function DraftTypeOption({ label, image, autoFocus, onChoose }: DraftTypeOptionProps) {
  return (
    <div className="draft-type-option">
      <button type="button" className="draft-type-button" aria-label={label} autoFocus={autoFocus} onClick={onChoose}>
        {image}
      </button>
      <span aria-hidden="true">{label}</span>
    </div>
  );
}

/**
 * The new draft: first its format, then its type, then its settings. Starting it imports the cube, if it's a cube
 * draft, and opens the lobby for players to join.
 */
export function CreateDraftModal({ previousSettings, onClose }: CreateDraftModalProps) {
  const [format, setFormat] = useState<DraftFormat>();
  const [type, setType] = useState<DraftType>();
  const [form, setForm] = useState(() => initialForm(previousSettings));
  const { pending, error, run } = useManagementAction();
  const set = DRAFTABLE_SETS.find((candidate) => candidate.code === form.setCode);
  const isWinston = format === "winston";
  const typeLabel = type === "cube" ? "Cube draft" : "Set draft";
  const winstonStackSize = form.packCount * (type === "set" && set ? set.packSize : form.packSize) * WINSTON_PLAYERS;

  function update(changes: Partial<DraftForm>) {
    setForm((current) => ({ ...current, ...changes }));
  }

  // Closing while the cube imports would hide a draft that still opens a moment later.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, onClose]);

  return (
    <div className="modal-backdrop" onClick={() => !pending && onClose()}>
      <div
        className="modal create-draft-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-draft-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="create-draft-heading">New draft</h2>
        </div>
        {format === undefined ? (
          <>
            <div className="draft-type-choice">
              <DraftTypeOption
                label="Normal draft"
                image={<NormalDraftImage />}
                autoFocus
                onChoose={() => setFormat("normal")}
              />
              <DraftTypeOption label="Winston draft" image={<WinstonDraftImage />} onChoose={() => setFormat("winston")} />
            </div>
            <p className="muted draft-format-hint">
              Normal: packs pass around the table. Winston: {WINSTON_PLAYERS} players take turns choosing from three
              piles.
            </p>
            <div className="modal-footer">
              <div className="modal-footer-end">
                <button type="button" className="secondary-button" onClick={onClose}>
                  Cancel
                </button>
              </div>
            </div>
          </>
        ) : type === undefined ? (
          <>
            <div className="draft-type-choice">
              <DraftTypeOption label="Cube draft" image={<CubeImage />} autoFocus onChoose={() => setType("cube")} />
              <DraftTypeOption label="Set draft" image={<CardStackImage />} onChoose={() => setType("set")} />
            </div>
            <div className="modal-footer">
              <button type="button" className="secondary-button" onClick={() => setFormat(undefined)}>
                Back
              </button>
              <div className="modal-footer-end">
                <button type="button" className="secondary-button" onClick={onClose}>
                  Cancel
                </button>
              </div>
            </div>
          </>
        ) : (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                (callback) =>
                  managementSocket.emit("manage:createDraft", toNewDraftSettings(format, type, form), callback),
                onClose
              );
            }}
          >
            <h3>{isWinston ? `Winston ${typeLabel.toLowerCase()}` : typeLabel}</h3>
            {type === "cube" ? (
              <label>
                CubeCobra cube URL or ID
                <input
                  value={form.cubeIdOrUrl}
                  onChange={(e) => update({ cubeIdOrUrl: e.target.value })}
                  placeholder="https://cubecobra.com/cube/overview/..."
                  required
                  autoFocus
                />
              </label>
            ) : (
              <label>
                Set
                <select value={form.setCode} onChange={(e) => update({ setCode: e.target.value })} autoFocus>
                  {DRAFTABLE_SETS.map((candidate) => (
                    <option key={candidate.code} value={candidate.code}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="form-row">
              <label>
                Packs per player
                <input
                  type="number"
                  min={1}
                  value={form.packCount}
                  onChange={(e) => update({ packCount: Number(e.target.value) })}
                  required
                />
              </label>
              {type === "cube" && (
                <label>
                  Cards per pack
                  <input
                    type="number"
                    min={1}
                    value={form.packSize}
                    onChange={(e) => update({ packSize: Number(e.target.value) })}
                    required
                  />
                </label>
              )}
            </div>
            {type === "set" && set && (
              <p className="muted">Every pack is a {set.name} Play Booster: {set.packSize} cards.</p>
            )}
            {isWinston ? (
              <p className="muted">
                For exactly {WINSTON_PLAYERS} players. Both players' packs are shuffled into one stack of{" "}
                {winstonStackSize} cards.
              </p>
            ) : (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.alternatingDraft}
                  onChange={(e) => update({ alternatingDraft: e.target.checked })}
                />
                Alternate pack direction each round
              </label>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-footer">
              <button type="button" className="secondary-button" disabled={pending} onClick={() => setType(undefined)}>
                Back
              </button>
              <div className="modal-footer-end">
                <button type="button" className="secondary-button" disabled={pending} onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" disabled={pending}>
                  {pending ? (type === "set" ? "Creating draft..." : "Importing cube...") : "Start draft"}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

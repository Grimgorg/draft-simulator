import { useEffect, useState } from "react";
import { DRAFTABLE_SETS, type DraftSettings, type NewDraftSettings } from "@draft-simulator/shared";
import { managementSocket } from "../managementSocket.js";
import { useManagementAction } from "../useManagementAction.js";

interface CreateDraftModalProps {
  /** The settings to start from: the finished draft's, when there is one. */
  previousSettings?: DraftSettings;
  onClose: () => void;
}

/** What the form edits: both a cube and a set, so switching between them keeps what was typed. */
interface DraftForm extends Omit<NewDraftSettings, "cubeIdOrUrl" | "setCode"> {
  cubeIdOrUrl: string;
  /** "cube", or the code of the set to draft. */
  source: string;
}

const CUBE_SOURCE = "cube";

const DEFAULT_FORM: DraftForm = {
  source: CUBE_SOURCE,
  cubeIdOrUrl: "",
  playerCount: 8,
  packCount: 3,
  packSize: 15,
  alternatingDraft: true,
};

function initialForm(previous: DraftSettings | undefined): DraftForm {
  if (!previous) return DEFAULT_FORM;
  const { cubeId, setCode, ...rest } = previous;
  // A set's pack size is the set's own; a later cube draft starts from the default instead.
  if (setCode !== undefined) return { ...rest, packSize: DEFAULT_FORM.packSize, source: setCode, cubeIdOrUrl: "" };
  return { ...rest, source: CUBE_SOURCE, cubeIdOrUrl: cubeId ?? "" };
}

function toNewDraftSettings({ source, cubeIdOrUrl, ...rest }: DraftForm): NewDraftSettings {
  return source === CUBE_SOURCE ? { ...rest, cubeIdOrUrl } : { ...rest, setCode: source };
}

/** The new draft's settings. Starting it imports the cube, if it's a cube draft, and opens the lobby for players to join. */
export function CreateDraftModal({ previousSettings, onClose }: CreateDraftModalProps) {
  const [settings, setSettings] = useState(() => initialForm(previousSettings));
  const { pending, error, run } = useManagementAction();
  const set = DRAFTABLE_SETS.find((candidate) => candidate.code === settings.source);

  function update(changes: Partial<DraftForm>) {
    setSettings((current) => ({ ...current, ...changes }));
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
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              (callback) => managementSocket.emit("manage:createDraft", toNewDraftSettings(settings), callback),
              onClose
            );
          }}
        >
          <label>
            Draft from
            <select value={settings.source} onChange={(e) => update({ source: e.target.value })}>
              <option value={CUBE_SOURCE}>A CubeCobra cube</option>
              {DRAFTABLE_SETS.map((candidate) => (
                <option key={candidate.code} value={candidate.code}>
                  {candidate.name} boosters
                </option>
              ))}
            </select>
          </label>
          {!set && (
            <label>
              CubeCobra cube URL or ID
              <input
                value={settings.cubeIdOrUrl}
                onChange={(e) => update({ cubeIdOrUrl: e.target.value })}
                placeholder="https://cubecobra.com/cube/overview/..."
                required
                autoFocus
              />
            </label>
          )}
          <div className="form-row">
            <label>
              Number of players
              <input
                type="number"
                min={2}
                value={settings.playerCount}
                onChange={(e) => update({ playerCount: Number(e.target.value) })}
                required
              />
            </label>
            <label>
              Packs per player
              <input
                type="number"
                min={1}
                value={settings.packCount}
                onChange={(e) => update({ packCount: Number(e.target.value) })}
                required
              />
            </label>
            {!set && (
              <label>
                Cards per pack
                <input
                  type="number"
                  min={1}
                  value={settings.packSize}
                  onChange={(e) => update({ packSize: Number(e.target.value) })}
                  required
                />
              </label>
            )}
          </div>
          {set && <p className="muted">Every pack is a {set.name} Play Booster: {set.packSize} cards.</p>}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.alternatingDraft}
              onChange={(e) => update({ alternatingDraft: e.target.checked })}
            />
            Alternate pack direction each round
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="panel-actions">
            <button type="submit" disabled={pending}>
              {pending ? (set ? "Creating draft..." : "Importing cube...") : "Start draft"}
            </button>
            <button type="button" disabled={pending} onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import type { DraftSettings, NewDraftSettings } from "@draft-simulator/shared";
import { managementSocket } from "../managementSocket.js";
import { useManagementAction } from "../useManagementAction.js";

interface CreateDraftModalProps {
  /** The settings to start from: the finished draft's, when there is one. */
  previousSettings?: DraftSettings;
  onClose: () => void;
}

const DEFAULT_SETTINGS: NewDraftSettings = {
  cubeIdOrUrl: "",
  playerCount: 8,
  packCount: 3,
  packSize: 15,
  alternatingDraft: true,
};

function initialSettings(previous: DraftSettings | undefined): NewDraftSettings {
  if (!previous) return DEFAULT_SETTINGS;
  const { cubeId, ...rest } = previous;
  return { cubeIdOrUrl: cubeId, ...rest };
}

/** The new draft's settings. Starting it imports the cube and opens the lobby for players to join. */
export function CreateDraftModal({ previousSettings, onClose }: CreateDraftModalProps) {
  const [settings, setSettings] = useState(() => initialSettings(previousSettings));
  const { pending, error, run } = useManagementAction();

  function update(changes: Partial<NewDraftSettings>) {
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
            run((callback) => managementSocket.emit("manage:createDraft", settings, callback), onClose);
          }}
        >
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
          </div>
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
              {pending ? "Importing cube..." : "Start draft"}
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

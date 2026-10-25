import { useState } from "react";
import type { LobbyStateView } from "@draft-simulator/shared";
import { ConfirmButton } from "../../components/ConfirmButton.js";
import { managementSocket } from "../managementSocket.js";
import { useManagementAction } from "../useManagementAction.js";
import { CreateDraftModal } from "./CreateDraftModal.js";

interface DraftPanelProps {
  lobby: LobbyStateView;
}

const STATUS_LABELS: Record<LobbyStateView["status"], string> = {
  empty: "No draft yet. Create one so players can join.",
  lobby: "Waiting for players to join.",
  drafting: "Drafting.",
  complete: "Finished. Players are building their decks.",
};

export function DraftPanel({ lobby }: DraftPanelProps) {
  const { settings, status } = lobby;
  const unresolved = lobby.unresolvedCardNames?.length ?? 0;
  const [creating, setCreating] = useState(false);
  const { pending, error, run } = useManagementAction();

  const start = () => run((callback) => managementSocket.emit("manage:startDraft", callback));
  const cancel = () => run((callback) => managementSocket.emit("manage:cancelDraft", callback));
  const seated = lobby.players.length;
  const full = settings !== undefined && seated >= settings.playerCount;

  return (
    <section className="panel" aria-labelledby="draft-heading">
      <h2 id="draft-heading">Current draft</h2>
      <p>{STATUS_LABELS[status]}</p>
      {settings && (
        <dl className="details">
          <dt>Cube</dt>
          <dd>
            {lobby.cubeName} ({lobby.cardCount} cards)
          </dd>
          <dt>Players</dt>
          <dd>
            {seated} of {settings.playerCount}
          </dd>
          <dt>Packs</dt>
          <dd>
            {settings.packCount} per player, {settings.packSize} cards each
          </dd>
          <dt>Passing</dt>
          <dd>{settings.alternatingDraft ? "Alternates direction each pack" : "Same direction every pack"}</dd>
          {status === "drafting" && (
            <>
              <dt>Progress</dt>
              <dd>
                Pack {lobby.currentPackNumber} of {settings.packCount}, pick {lobby.currentPickNumber} of{" "}
                {settings.packSize}
              </dd>
            </>
          )}
        </dl>
      )}
      {unresolved > 0 && (
        <p className="warning">
          {unresolved === 1
            ? "1 card in the cube wasn't found in the card database and is left out."
            : `${unresolved} cards in the cube weren't found in the card database and are left out.`}
        </p>
      )}

      <div className="panel-actions">
        {status === "empty" && (
          <button type="button" onClick={() => setCreating(true)}>
            Create draft
          </button>
        )}
        {status === "complete" && (
          <ConfirmButton
            label="Create draft"
            confirmMessage="Create a new draft? The finished one is cleared for everyone, with their pools and decks."
            confirmLabel="Create a new draft"
            onConfirm={() => setCreating(true)}
          />
        )}
        {status === "lobby" && settings && (
          <button type="button" disabled={!full || pending} onClick={start}>
            {full ? "Start picking" : `Waiting for players (${seated} of ${settings.playerCount})`}
          </button>
        )}
        {(status === "lobby" || status === "drafting") && (
          <ConfirmButton
            label="Cancel draft"
            className="danger-button"
            confirmMessage="Cancel this draft? Everyone is removed and all picks are lost. This can't be undone."
            confirmLabel="Yes, cancel draft"
            disabled={pending}
            onConfirm={cancel}
          />
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {creating && <CreateDraftModal previousSettings={settings} onClose={() => setCreating(false)} />}
    </section>
  );
}

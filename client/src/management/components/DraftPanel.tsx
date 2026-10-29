import { useState } from "react";
import { MIN_PLAYERS, WINSTON_PLAYERS, type LobbyStateView } from "@draft-simulator/shared";
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
  const isWinston = settings?.format === "winston";
  const neededPlayers = isWinston ? WINSTON_PLAYERS : MIN_PLAYERS;
  const enoughPlayers = seated >= neededPlayers;
  const activeName = lobby.players.find((p) => p.id === lobby.winston?.activePlayerId)?.name;

  return (
    <section className="panel" aria-labelledby="draft-heading">
      <h2 id="draft-heading">Current draft</h2>
      <p>{STATUS_LABELS[status]}</p>
      {settings && (
        <dl className="details">
          <dt>Format</dt>
          <dd>{isWinston ? `Winston draft for ${WINSTON_PLAYERS} players` : "Normal draft"}</dd>
          <dt>{settings.setCode !== undefined ? "Set" : "Cube"}</dt>
          <dd>
            {lobby.cubeName} ({lobby.cardCount} cards)
          </dd>
          <dt>Players</dt>
          <dd>{seated}</dd>
          <dt>Packs</dt>
          <dd>
            {settings.packCount} per player, {settings.packSize} cards each
          </dd>
          {!isWinston && (
            <>
              <dt>Passing</dt>
              <dd>{settings.alternatingDraft ? "Alternates direction each pack" : "Same direction every pack"}</dd>
            </>
          )}
          {status === "drafting" && lobby.winston && (
            <>
              <dt>Progress</dt>
              <dd>
                {activeName}'s turn, {lobby.winston.stackCount} cards left in the stack
              </dd>
            </>
          )}
          {status === "drafting" && !isWinston && (
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
          <button type="button" disabled={!enoughPlayers || pending} onClick={start}>
            {enoughPlayers
              ? "Start picking"
              : `Waiting for players (${seated} of ${isWinston ? "" : "at least "}${neededPlayers})`}
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

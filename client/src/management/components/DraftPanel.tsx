import type { LobbyStateView } from "@draft-simulator/shared";

interface DraftPanelProps {
  lobby: LobbyStateView;
}

const STATUS_LABELS: Record<LobbyStateView["status"], string> = {
  empty: "No draft yet. The first player to open the player page sets one up.",
  lobby: "Waiting for players to join.",
  drafting: "Drafting.",
  complete: "Finished. Players are building their decks.",
};

export function DraftPanel({ lobby }: DraftPanelProps) {
  const { settings } = lobby;
  const unresolved = lobby.unresolvedCardNames?.length ?? 0;

  return (
    <section className="panel" aria-labelledby="draft-heading">
      <h2 id="draft-heading">Current draft</h2>
      <p>{STATUS_LABELS[lobby.status]}</p>
      {settings && (
        <dl className="details">
          <dt>Cube</dt>
          <dd>
            {lobby.cubeName} ({lobby.cardCount} cards)
          </dd>
          <dt>Players</dt>
          <dd>
            {lobby.players.length} of {settings.playerCount}
          </dd>
          <dt>Packs</dt>
          <dd>
            {settings.packCount} per player, {settings.packSize} cards each
          </dd>
          <dt>Passing</dt>
          <dd>{settings.alternatingDraft ? "Alternates direction each pack" : "Same direction every pack"}</dd>
          {lobby.status === "drafting" && (
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
          {unresolved} {unresolved === 1 ? "card" : "cards"} in the cube weren't found in the card database and are left
          out.
        </p>
      )}
    </section>
  );
}

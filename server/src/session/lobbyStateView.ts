import type { DraftSummary, LobbyStateView, Player, SeatView } from "@draft-simulator/shared";
import { findCardsByNames } from "../cardData/cardRepository.js";
import { buildWinstonTableView } from "../draftEngine/winstonDraft.js";
import * as lobbyManager from "./lobbyManager.js";

function buildSeatViews(draftId: string, players: Player[]): SeatView[] {
  return players.map((player) => ({ ...player, claimable: lobbyManager.isSeatClaimable(draftId, player.id) }));
}

const BASIC_LAND_NAMES = ["Plains", "Island", "Swamp", "Mountain", "Forest"];

/** The state of one draft for the players seated in it, or undefined when it doesn't exist. */
export function buildLobbyStateView(draftId: string): LobbyStateView | undefined {
  const session = lobbyManager.getSession(draftId);
  if (!session) return undefined;

  const cubeMeta = lobbyManager.getCubeMeta(draftId);
  const isDrafting = session.status === "drafting";
  // A Winston draft has no packs to number: its table says where it is.
  const isPackDraft = isDrafting && session.settings.format !== "winston";
  const isComplete = session.status === "complete";

  return {
    status: session.status,
    sessionId: session.id,
    creatorPlayerId: lobbyManager.getCreatorPlayerId(draftId),
    settings: session.settings,
    cubeName: cubeMeta?.cubeName,
    cardCount: cubeMeta?.cardCount,
    unresolvedCardNames: cubeMeta?.unresolvedCardNames,
    players: buildSeatViews(draftId, session.players),
    currentPackNumber: isPackDraft ? session.currentPackNumber : undefined,
    currentPickNumber: isPackDraft ? session.currentPickNumber : undefined,
    waitingOn: isDrafting ? session.waitingOn : undefined,
    winston: buildWinstonTableView(session),
    basicLands: isComplete ? [...findCardsByNames(BASIC_LAND_NAMES).values()] : undefined,
  };
}

/** Every draft as the draft list shows it, newest first. */
export function buildDraftSummaries(): DraftSummary[] {
  return lobbyManager
    .listDrafts()
    .map(({ session, cubeMeta, createdAt }) => ({
      draftId: session.id,
      status: session.status,
      settings: session.settings,
      cubeName: cubeMeta.cubeName,
      cardCount: cubeMeta.cardCount,
      players: buildSeatViews(session.id, session.players),
      creatorPlayerId: lobbyManager.getCreatorPlayerId(session.id),
      createdAt,
    }))
    .reverse();
}

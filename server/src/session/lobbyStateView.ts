import type { LobbyStateView } from "@draft-simulator/shared";
import { findCardsByNames } from "../cardData/cardRepository.js";
import { buildWinstonTableView } from "../draftEngine/winstonDraft.js";
import * as lobbyManager from "./lobbyManager.js";

const BASIC_LAND_NAMES = ["Plains", "Island", "Swamp", "Mountain", "Forest"];

export function buildLobbyStateView(): LobbyStateView {
  const session = lobbyManager.getSession();
  if (!session) {
    return { status: "empty", players: [] };
  }

  const cubeMeta = lobbyManager.getCubeMeta();
  const isDrafting = session.status === "drafting";
  // A Winston draft has no packs to number: its table says where it is.
  const isPackDraft = isDrafting && session.settings.format !== "winston";
  const isComplete = session.status === "complete";

  return {
    status: session.status,
    sessionId: session.id,
    settings: session.settings,
    cubeName: cubeMeta?.cubeName,
    cardCount: cubeMeta?.cardCount,
    unresolvedCardNames: cubeMeta?.unresolvedCardNames,
    players: session.players,
    currentPackNumber: isPackDraft ? session.currentPackNumber : undefined,
    currentPickNumber: isPackDraft ? session.currentPickNumber : undefined,
    waitingOn: isDrafting ? session.waitingOn : undefined,
    winston: buildWinstonTableView(session),
    basicLands: isComplete ? [...findCardsByNames(BASIC_LAND_NAMES).values()] : undefined,
  };
}

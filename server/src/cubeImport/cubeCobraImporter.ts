import type { Card } from "@draft-simulator/shared";
import { findCardByOracleId, findCardsByNames } from "../cardData/cardRepository.js";

const USER_AGENT = "DraftSimulator/0.1 (personal cube draft tool; not for redistribution)";

/** Overridable so the browser end-to-end tests can serve a fixed cube from a local stand-in. */
function cubeCobraBaseUrl(): string {
  return process.env.CUBECOBRA_BASE_URL ?? "https://cubecobra.com";
}

interface CubeCobraCardEntry {
  details?: { name?: string; oracle_id?: string };
}

interface CubeCobraCubeJson {
  name: string;
  cards: {
    mainboard: CubeCobraCardEntry[];
  };
}

export interface CubeImportResult {
  cubeName: string;
  /** Resolved cards, one entry per physical card slot in the cube (duplicates preserved). */
  cards: Card[];
  /** Card names present in the cube but not found in the local Scryfall cache. */
  unresolvedNames: string[];
}

/** Accepts a bare cube id/short id, or a full CubeCobra URL in any of its cube sub-page forms. */
function extractCubeId(input: string): string {
  const match = input.trim().match(/cubecobra\.com\/cube\/[^/]+\/([^/?#]+)/i);
  return match ? match[1] : input.trim();
}

export async function importCubeFromCubeCobra(cubeIdOrUrl: string): Promise<CubeImportResult> {
  const cubeId = extractCubeId(cubeIdOrUrl);
  if (!cubeId) {
    throw new Error("No cube id or URL provided");
  }

  const res = await fetch(`${cubeCobraBaseUrl()}/cube/api/cubeJSON/${encodeURIComponent(cubeId)}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Could not fetch cube "${cubeId}" from CubeCobra: ${res.status} ${res.statusText}`);
  }
  const cube = (await res.json()) as CubeCobraCubeJson;

  const entries = cube.cards.mainboard
    .map((entry) => ({ name: entry.details?.name, oracleId: entry.details?.oracle_id }))
    .filter((entry): entry is { name: string; oracleId: string | undefined } => Boolean(entry.name));

  const resolvedByName = findCardsByNames([...new Set(entries.map((entry) => entry.name))]);

  const cards: Card[] = [];
  const unresolvedNames: string[] = [];
  for (const { name, oracleId } of entries) {
    // CubeCobra names some printings by a name only that printing carries, e.g. a
    // Through the Omenpaths card ("Makdee and Itla, Skysnarers") whose Scryfall name is
    // "Spider-Woman, Stunning Savior". Its oracle id still finds the card.
    if (!resolvedByName.has(name) && oracleId) {
      const card = findCardByOracleId(oracleId);
      if (card) resolvedByName.set(name, card);
    }
    const card = resolvedByName.get(name);
    if (card) {
      cards.push(card);
    } else {
      unresolvedNames.push(name);
    }
  }

  if (cards.length === 0) {
    throw new Error(
      "None of this cube's cards could be resolved against the local card database. Try re-running the card import."
    );
  }

  return {
    cubeName: cube.name,
    cards,
    unresolvedNames: [...new Set(unresolvedNames)],
  };
}

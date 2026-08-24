import type { Card, DraftSettings, Pack } from "@draft-simulator/shared";

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/**
 * Splits a shuffled card pool into packs for a draft.
 *
 * Returns packQueue[round][seat]: the pack dealt to seat `seat` at the start
 * of pack round `round` (both 0-indexed). The draft engine consumes this
 * round by round, dealing a fresh set of packs to every seat at the start of
 * each pack number.
 */
export function generatePacks(cardPool: Card[], settings: DraftSettings, playerCount: number): Pack[][] {
  const totalPacksNeeded = settings.packCount * playerCount;
  const totalCardsNeeded = totalPacksNeeded * settings.packSize;

  if (cardPool.length < totalCardsNeeded) {
    throw new Error(
      `Cube has ${cardPool.length} cards but ${totalCardsNeeded} are needed for ` +
        `${settings.packCount} pack(s) of ${settings.packSize} across ${playerCount} players`
    );
  }

  const shuffled = shuffle(cardPool);
  const packQueue: Pack[][] = [];
  let cursor = 0;

  for (let round = 0; round < settings.packCount; round++) {
    const roundPacks: Pack[] = [];
    for (let seat = 0; seat < playerCount; seat++) {
      roundPacks.push({
        id: `pack-${round + 1}-${seat}`,
        packNumber: round + 1,
        cards: shuffled.slice(cursor, cursor + settings.packSize),
      });
      cursor += settings.packSize;
    }
    packQueue.push(roundPacks);
  }

  return packQueue;
}

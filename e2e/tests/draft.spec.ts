import type { Page } from "@playwright/test";
import { CUBE_CARDS, expect, test } from "../fixtures.js";
import {
  CARDS_PER_PACK,
  PACKS,
  PICKS_PER_PLAYER,
  draftWholeCube,
  expectPoolSize,
  packCards,
  pickFirstCard,
  startTwoPlayerDraft,
} from "../helpers.js";

function cardNamesIn(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).getByRole("img").evaluateAll((imgs) => imgs.map((img) => img.getAttribute("alt")!));
}

test("host and guest draft the whole cube and each builds a deck from exactly their own picks", async ({
  openManagement,
  openPlayer,
}) => {
  const { host, guest } = await startTwoPlayerDraft(openManagement, openPlayer);
  const picks = await draftWholeCube(host, guest);

  for (const [page, myPicks] of [
    [host, picks.host],
    [guest, picks.guest],
  ] as const) {
    await expect(page.getByRole("heading", { name: "Draft complete!" })).toBeVisible();
    await expect(page.getByText(`${PICKS_PER_PLAYER} / 40 cards`)).toBeVisible();
    expect((await cardNamesIn(page, ".deck-pane")).sort()).toEqual([...myPicks].sort());
  }
  expect([...picks.host, ...picks.guest].sort()).toEqual([...CUBE_CARDS].sort());
});

test("a player who refreshes mid-draft gets back the same pack and pool and keeps picking", async ({
  openManagement,
  openPlayer,
}) => {
  const { host, guest } = await startTwoPlayerDraft(openManagement, openPlayer);
  await pickFirstCard(host);
  await expectPoolSize(host, 1);
  await pickFirstCard(guest);
  await expectPoolSize(guest, 1);
  // Both packs have passed, so the guest now holds the host's pack.
  await expect(guest.getByRole("heading", { name: `Pack 1 of ${PACKS}, pick 2` })).toBeVisible();
  await expect(packCards(guest)).toHaveCount(CARDS_PER_PACK - 1);
  const packBefore = await packCards(guest).evaluateAll((cards) => cards.map((c) => c.getAttribute("aria-label")));
  const poolBefore = await cardNamesIn(guest, ".pool-pane");

  await guest.reload();

  await expect(guest.getByRole("heading", { name: `Pack 1 of ${PACKS}, pick 2` })).toBeVisible();
  await expectPoolSize(guest, 1);
  await expect(packCards(guest)).toHaveCount(packBefore.length);
  expect(await packCards(guest).evaluateAll((cards) => cards.map((c) => c.getAttribute("aria-label")))).toEqual(
    packBefore
  );
  expect(await cardNamesIn(guest, ".pool-pane")).toEqual(poolBefore);

  // The reloaded page is still the guest's seat, not a read-only view: the draft carries on into pack 2.
  await pickFirstCard(guest);
  await expectPoolSize(guest, 2);
  await pickFirstCard(host);
  await expect(guest.getByRole("heading", { name: `Pack 2 of ${PACKS}, pick 1` })).toBeVisible();
  await expect(host.getByRole("heading", { name: `Pack 2 of ${PACKS}, pick 1` })).toBeVisible();
});

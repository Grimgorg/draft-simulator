import type { Page } from "@playwright/test";
import { CUBE_CARDS, CUBE_ID, CUBE_NAME, expect, test } from "../fixtures.js";

// Two players, two packs of two cards each: the 8-card test cube, fully drafted in four picks.
const PACKS = 2;
const CARDS_PER_PACK = 2;
const PICKS_PER_PLAYER = PACKS * CARDS_PER_PACK;

async function createDraft(host: Page): Promise<void> {
  await host.getByLabel("Your name").fill("Alice");
  await host.getByLabel("CubeCobra cube URL or ID").fill(CUBE_ID);
  await host.getByLabel("Number of players").fill("2");
  await host.getByLabel("Packs per player").fill(String(PACKS));
  await host.getByLabel("Cards per pack").fill(String(CARDS_PER_PACK));
  await host.getByRole("button", { name: "Create draft" }).click();
  await expect(host.getByRole("heading", { name: CUBE_NAME })).toBeVisible();
}

async function joinDraft(guest: Page): Promise<void> {
  await guest.getByLabel("Your name").fill("Bob");
  await guest.getByRole("button", { name: "Join draft" }).click();
  await expect(guest.getByText("Waiting for the host to start the draft...")).toBeVisible();
}

/** Host creates the draft, a guest joins from a second browser, and the host starts it. */
async function startTwoPlayerDraft(openPlayer: () => Promise<Page>): Promise<{ host: Page; guest: Page }> {
  const host = await openPlayer();
  await createDraft(host);
  const guest = await openPlayer();
  await joinDraft(guest);
  await host.getByRole("button", { name: "Start draft" }).click();
  return { host, guest };
}

function packCards(page: Page) {
  return page.locator(".pack-grid").getByRole("button");
}

/** Picks the first card in the player's pack, waiting for it to be their turn, and returns its name. */
async function pickFirstCard(page: Page): Promise<string> {
  const card = packCards(page).first();
  const name = await card.getAttribute("aria-label");
  await card.click();
  return name!;
}

/** Waits until the player's pool shows `count` cards, i.e. the server has taken their last pick. */
async function expectPoolSize(page: Page, count: number): Promise<void> {
  await expect(page.getByRole("heading", { name: `Your pool (${count})` })).toBeVisible();
}

function cardNamesIn(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).getByRole("img").evaluateAll((imgs) => imgs.map((img) => img.getAttribute("alt")!));
}

test("host and guest draft the whole cube and each builds a deck from exactly their own picks", async ({
  openPlayer,
}) => {
  const { host, guest } = await startTwoPlayerDraft(openPlayer);
  const picks = new Map<Page, string[]>([
    [host, []],
    [guest, []],
  ]);

  for (let pick = 1; pick <= PICKS_PER_PLAYER; pick++) {
    picks.get(host)!.push(await pickFirstCard(host));
    await expectPoolSize(host, pick);
    picks.get(guest)!.push(await pickFirstCard(guest));
    // The guest's last pick ends the draft, which replaces the pool with the deck builder.
    if (pick < PICKS_PER_PLAYER) await expectPoolSize(guest, pick);
  }

  for (const [page, myPicks] of picks) {
    await expect(page.getByRole("heading", { name: "Draft complete!" })).toBeVisible();
    await expect(page.getByText(`${PICKS_PER_PLAYER} / 40 cards`)).toBeVisible();
    expect((await cardNamesIn(page, ".deck-pane")).sort()).toEqual([...myPicks].sort());
  }
  expect([...picks.get(host)!, ...picks.get(guest)!].sort()).toEqual([...CUBE_CARDS].sort());
});

test("a player who refreshes mid-draft gets back the same pack and pool and keeps picking", async ({
  openPlayer,
}) => {
  const { host, guest } = await startTwoPlayerDraft(openPlayer);
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

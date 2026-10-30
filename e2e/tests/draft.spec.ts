import type { Page } from "@playwright/test";
import { CUBE_CARDS, CUBE_NAME, expect, test } from "../fixtures.js";
import {
  CARDS_PER_PACK,
  NO_DRAFT_MESSAGE,
  PACKS,
  PICKS_PER_PLAYER,
  createDraft,
  draftWholeCube,
  expectPoolSize,
  joinDraft,
  packCards,
  pickFirstCard,
  startTwoPlayerDraft,
} from "../helpers.js";

function cardNamesIn(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).getByRole("img").evaluateAll((imgs) => imgs.map((img) => img.getAttribute("alt")!));
}

/** The card names in each of the player's pool piles, bottom to top. */
function poolPiles(page: Page): Promise<string[][]> {
  return page
    .locator(".pool-pane .pile")
    .evaluateAll((piles) =>
      piles.map((pile) => Array.from(pile.querySelectorAll("img"), (img) => img.getAttribute("alt")!))
    );
}

test("a player waiting for the draft to start looks through the cube's cards", async ({
  openManagement,
  openPlayer,
}) => {
  const management = await openManagement();
  const player = await openPlayer();
  await expect(player.getByText(NO_DRAFT_MESSAGE)).toBeVisible();
  await createDraft(management);
  await joinDraft(player, "Alice");

  await player.getByRole("button", { name: "Preview cube" }).click();
  const preview = player.getByRole("dialog", { name: CUBE_NAME });
  await expect(preview.getByText(`${CUBE_CARDS.length} unique cards`)).toBeVisible();
  expect((await cardNamesIn(player, ".modal")).sort()).toEqual([...CUBE_CARDS].sort());
  await preview.getByRole("button", { name: "Close preview" }).click();
  await expect(preview).toBeHidden();
});

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

test("a player stacks pool cards and takes one out of the middle with Ctrl+drag", async ({
  openManagement,
  openPlayer,
}) => {
  const { host, guest } = await startTwoPlayerDraft(openManagement, openPlayer);
  for (let pick = 1; pick <= 3; pick++) {
    await pickFirstCard(host);
    await expectPoolSize(host, pick);
    await pickFirstCard(guest);
    await expectPoolSize(guest, pick);
  }
  const [[a], [b], [c]] = await poolPiles(host);
  const piles = host.locator(".pool-pane .pile");

  // A plain drag moves a pile's card onto another pile.
  await piles.nth(1).locator(".pile-card").dragTo(piles.nth(0));
  await expect.poll(() => poolPiles(host)).toEqual([[a, b], [c]]);
  await piles.nth(1).locator(".pile-card").dragTo(piles.nth(0));
  await expect.poll(() => poolPiles(host)).toEqual([[a, b, c]]);

  // Ctrl+drag grabs the middle card by its visible top band and takes only it to a new pile, not the card on top too.
  // ⌘ on macOS, where Ctrl+mousedown opens the context menu instead of starting the drag.
  await host.keyboard.down("ControlOrMeta");
  await piles
    .nth(0)
    .locator(".pile-card")
    .nth(1)
    .dragTo(host.locator(".pool-pane .pile-row"), {
      sourcePosition: { x: 75, y: 10 },
      targetPosition: { x: 600, y: 20 },
    });
  await host.keyboard.up("ControlOrMeta");
  await expect.poll(() => poolPiles(host)).toEqual([[a, c], [b]]);

  await host.getByRole("button", { name: "Keyboard shortcuts" }).hover();
  await expect(host.getByRole("tooltip")).toContainText("Ctrl (⌘ on Mac) + drag");
});

test("the pool wraps into rows instead of scrolling sideways, and a wide window keeps the preview off the cards", async ({
  openManagement,
  openPlayer,
}) => {
  const { host, guest } = await startTwoPlayerDraft(openManagement, openPlayer);
  // Room for two piles a row.
  await host.setViewportSize({ width: 450, height: 900 });
  for (let pick = 1; pick <= 3; pick++) {
    await pickFirstCard(host);
    await expectPoolSize(host, pick);
    await pickFirstCard(guest);
    await expectPoolSize(guest, pick);
  }
  const pileTops = await host.locator(".pool-pane .pile").evaluateAll((piles) => piles.map((p) => p.getBoundingClientRect().top));
  expect(pileTops[2]).toBeGreaterThan(pileTops[0]!);
  const row = host.locator(".pool-pane .pile-row");
  expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

  await host.setViewportSize({ width: 1600, height: 900 });
  await packCards(host).first().hover();
  const preview = await host.locator(".card-preview-overlay").boundingBox();
  const pack = await host.locator(".pack-pane").boundingBox();
  const pool = await host.locator(".pool-pane").boundingBox();
  expect(preview!.x).toBeGreaterThanOrEqual(pack!.x + pack!.width);
  expect(preview!.x).toBeGreaterThanOrEqual(pool!.x + pool!.width);
});

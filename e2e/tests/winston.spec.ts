import type { Page } from "@playwright/test";
import { CUBE_CARDS, CUBE_ID, expect, test } from "../fixtures.js";
import { createDraft, draftListItem, joinDraft, NO_DRAFT_MESSAGE, openNewDraftDialog, panel } from "../helpers.js";

function deckCardNames(page: Page): Promise<string[]> {
  return page.locator(".deck-pane").getByRole("img").evaluateAll((imgs) => imgs.map((img) => img.getAttribute("alt")!));
}

function pileCards(page: Page) {
  return page.locator(".pack-grid").getByRole("img");
}

function stackCount(page: Page) {
  return page.locator(".winston-stack .winston-count");
}

test("two players Winston-draft the whole cube, taking turns at the piles", async ({ openManagement, openPlayer }) => {
  const management = await openManagement();
  const host = await openPlayer();
  await expect(host.getByText(NO_DRAFT_MESSAGE)).toBeVisible();
  // 2 packs of 2 cards for each player: the 8-card test cube.
  await createDraft(host, "Alice", CUBE_ID, "Winston draft");
  await expect(host.getByText(/Winston draft for 2/)).toBeVisible();
  const draft = panel(management, "Drafts");
  await expect(draft).toContainText("Winston draft for 2");

  const guest = await openPlayer();
  await expect(draftListItem(guest)).toContainText("Winston draft for 2");
  await joinDraft(guest, "Bob");
  // A Winston draft is for exactly two players.
  const third = await openPlayer();
  await draftListItem(third).getByRole("button", { name: "Join" }).click();
  await third.getByLabel("Your name").fill("Cara");
  await third.getByRole("button", { name: "Join draft" }).click();
  await expect(third.getByText("already has its 2 players")).toBeVisible();
  await host.getByRole("button", { name: "Start picking" }).click();

  // Alice passes pile 1, which grows to two cards, and takes pile 2.
  await expect(host.getByRole("heading", { name: "Your turn: pile 1" })).toBeVisible();
  await expect(guest.getByRole("heading", { name: "Alice's turn" })).toBeVisible();
  await expect(pileCards(guest)).toHaveCount(0);
  await expect(pileCards(host)).toHaveCount(1);
  await expect(stackCount(guest)).toHaveText("5");
  await expect(draft).toContainText("Drafting");
  await host.getByRole("button", { name: "Pass", exact: true }).click();
  await expect(host.getByRole("heading", { name: "Your turn: pile 2" })).toBeVisible();
  await expect(guest.getByText("Alice is looking at pile 2...")).toBeVisible();
  await host.getByRole("button", { name: "Take pile (1 card)" }).click();

  // Bob gets pile 1 with the card Alice's pass added, then everyone takes pile 1 until the stack and piles run out:
  // seven turns in all.
  await expect(guest.getByRole("heading", { name: "Your turn: pile 1" })).toBeVisible();
  await expect(pileCards(guest)).toHaveCount(2);
  await guest.getByRole("button", { name: "Take pile (2 cards)" }).click();
  for (let turn = 3; turn <= 7; turn++) {
    const active = turn % 2 === 1 ? host : guest;
    await expect(active.getByRole("heading", { name: /^Your turn/ })).toBeVisible();
    await active.getByRole("button", { name: /^Take pile/ }).click();
    if (turn < 7) await expect(active.getByRole("heading", { name: /'s turn$/ })).toBeVisible();
  }

  await expect(draft).toContainText("Finished");
  const pools: string[][] = [];
  for (const page of [host, guest]) {
    await expect(page.getByRole("heading", { name: "Draft complete!" })).toBeVisible();
    await expect(page.getByText("4 / 40 cards")).toBeVisible();
    pools.push(await deckCardNames(page));
  }
  expect(pools.flat().sort()).toEqual([...CUBE_CARDS].sort());
});

test("a player creates a Winston draft from a set's boosters", async ({ openPlayer }) => {
  const host = await openPlayer();
  const dialog = await openNewDraftDialog(host, "Winston draft", "Set draft");
  await expect(dialog.getByRole("heading", { name: "Winston set draft" })).toBeVisible();
  await expect(dialog.getByLabel("Alternate pack direction each round")).toBeHidden();
  await expect(dialog.getByText("shuffled into one stack of 84 cards")).toBeVisible();
  await dialog.getByLabel("Your name").fill("Alice");
  await dialog.getByRole("button", { name: "Create draft" }).click();
  await expect(dialog).toBeHidden();
  await expect(host.getByRole("heading", { name: "Reality Fracture" })).toBeVisible();
  await expect(host.getByText(/Winston draft for 2/)).toBeVisible();

  const guest = await openPlayer();
  await joinDraft(guest, "Bob", "Reality Fracture");
  await host.getByRole("button", { name: "Start picking" }).click();

  // 3 Play Boosters of 14 for each player, less the three cards that start the piles.
  await expect(stackCount(host)).toHaveText("81");
  await expect(pileCards(host)).toHaveCount(1);
  await host.getByRole("button", { name: "Take pile (1 card)" }).click();
  await expect(host.getByRole("heading", { name: "Your pool (1)" })).toBeVisible();
  await expect(guest.getByRole("heading", { name: "Your turn: pile 1" })).toBeVisible();
});

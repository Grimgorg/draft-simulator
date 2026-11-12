import type { Page } from "@playwright/test";
import { CUBE_ID, CUBE_NAME, expect } from "./fixtures.js";

// Two players, two packs of two cards each: the 8-card test cube, fully drafted in four picks.
export const PACKS = 2;
export const CARDS_PER_PACK = 2;
export const PICKS_PER_PLAYER = PACKS * CARDS_PER_PACK;

// A browser's socket waits up to 5s between reconnect attempts, so coming
// back after a stop or restart can take that long.
export const RECONNECT_TIMEOUT = 15_000;

export const NO_DRAFT_MESSAGE = "No drafts yet. Create one, then send the link to your friends.";

export type DraftFormat = "Normal draft" | "Winston draft";

/**
 * Opens the New draft dialog on the player page and picks the format and type. A set draft keeps the set the
 * dialog offers first.
 */
export async function openNewDraftDialog(player: Page, format: DraftFormat, type: "Cube draft" | "Set draft") {
  await player.getByRole("button", { name: "Create draft" }).click();
  const dialog = player.getByRole("dialog", { name: "New draft" });
  await dialog.getByRole("button", { name: format }).click();
  await dialog.getByRole("button", { name: type }).click();
  return dialog;
}

/** The waiting room only a seated player sees: its creator's start button, or the wait for the creator. */
async function expectSeated(player: Page): Promise<void> {
  await expect(
    player.getByRole("button", { name: /^(Start picking|Waiting for players)/ }).or(
      player.getByText(/^Waiting for .+ to start the draft...$/)
    )
  ).toBeVisible();
}

/** `player` creates a draft of the test cube from the player page, and is seated in it as `name`. */
export async function createDraft(
  player: Page,
  name: string,
  cubeId = CUBE_ID,
  format: DraftFormat = "Normal draft"
): Promise<void> {
  const dialog = await openNewDraftDialog(player, format, "Cube draft");
  await dialog.getByLabel("Your name").fill(name);
  await dialog.getByLabel("CubeCobra cube URL or ID").fill(cubeId);
  await dialog.getByLabel("Packs per player").fill(String(PACKS));
  await dialog.getByLabel("Cards per pack").fill(String(CARDS_PER_PACK));
  await dialog.getByRole("button", { name: "Create draft" }).click();
  await expect(dialog).toBeHidden();
  await expectSeated(player);
}

/** The draft's entry in the player page's draft list. */
export function draftListItem(player: Page, cubeName = CUBE_NAME) {
  return player.getByRole("listitem").filter({ has: player.getByRole("heading", { name: cubeName }) });
}

/** Opens the draft from the list and joins it as a new player. */
export async function joinDraft(player: Page, name: string, cubeName = CUBE_NAME): Promise<void> {
  await draftListItem(player, cubeName).getByRole("button", { name: "Join" }).click();
  await player.getByLabel("Your name").fill(name);
  await player.getByRole("button", { name: "Join draft" }).click();
  await expectSeated(player);
}

/** The host creates the draft from the player page, the guest joins it from a second browser, and the host starts it. */
export async function startTwoPlayerDraft(openPlayer: () => Promise<Page>): Promise<{ host: Page; guest: Page }> {
  const host = await openPlayer();
  await expect(host.getByText(NO_DRAFT_MESSAGE)).toBeVisible();
  await createDraft(host, "Alice");
  const guest = await openPlayer();
  await joinDraft(guest, "Bob");
  await host.getByRole("button", { name: "Start picking" }).click();
  return { host, guest };
}

/** A management UI section, found by its heading. */
export function panel(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

/** Panels on other tabs are hidden, so getByRole doesn't find them. */
export async function openTab(page: Page, name: "Draft" | "Settings" | "Logs"): Promise<void> {
  await page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
}

export function packCards(page: Page) {
  return page.locator(".pack-grid").getByRole("button");
}

/** Picks the first card in the player's pack, waiting for it to be their turn, and returns its name. */
export async function pickFirstCard(page: Page): Promise<string> {
  const card = packCards(page).first();
  const name = await card.getAttribute("aria-label");
  await card.click();
  return name!;
}

/** Waits until the player's pool shows `count` cards, i.e. the server has taken their last pick. */
export async function expectPoolSize(page: Page, count: number): Promise<void> {
  await expect(page.getByRole("heading", { name: `Your pool (${count})` })).toBeVisible();
}

/** Both players pick until the cube is drafted, and get back the names each one picked. */
export async function draftWholeCube(host: Page, guest: Page): Promise<{ host: string[]; guest: string[] }> {
  const picks = { host: [] as string[], guest: [] as string[] };
  for (let pick = 1; pick <= PICKS_PER_PLAYER; pick++) {
    picks.host.push(await pickFirstCard(host));
    await expectPoolSize(host, pick);
    picks.guest.push(await pickFirstCard(guest));
    // The guest's last pick ends the draft, which replaces the pool with the deck builder.
    if (pick < PICKS_PER_PLAYER) await expectPoolSize(guest, pick);
  }
  return picks;
}

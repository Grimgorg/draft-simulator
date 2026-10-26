import type { Page } from "@playwright/test";
import { CUBE_ID, expect } from "./fixtures.js";

// Two players, two packs of two cards each: the 8-card test cube, fully drafted in four picks.
export const PACKS = 2;
export const CARDS_PER_PACK = 2;
export const PICKS_PER_PLAYER = PACKS * CARDS_PER_PACK;

// A browser's socket waits up to 5s between reconnect attempts, so coming
// back after a stop or restart can take that long.
export const RECONNECT_TIMEOUT = 15_000;

export const NO_DRAFT_MESSAGE = "The host needs to create and start a draft before players can join.";

export async function createDraft(management: Page, cubeId = CUBE_ID): Promise<void> {
  await management.getByRole("button", { name: "Create draft" }).click();
  const dialog = management.getByRole("dialog", { name: "New draft" });
  await dialog.getByRole("button", { name: "Cube draft" }).click();
  await dialog.getByLabel("CubeCobra cube URL or ID").fill(cubeId);
  await dialog.getByLabel("Packs per player").fill(String(PACKS));
  await dialog.getByLabel("Cards per pack").fill(String(CARDS_PER_PACK));
  await dialog.getByRole("button", { name: "Start draft" }).click();
  await expect(dialog).toBeHidden();
}

export async function joinDraft(player: Page, name: string): Promise<void> {
  await player.getByLabel("Your name").fill(name);
  await player.getByRole("button", { name: "Join draft" }).click();
  // Only a seated player gets here: the join screen shows the cube's name too.
  await expect(player.getByText("Waiting for the host to start the draft...")).toBeVisible();
}

/**
 * The host creates the draft in the management UI, joins it from the player page like the guest does from a
 * second browser, and starts it from the management UI.
 */
export async function startTwoPlayerDraft(
  openManagement: () => Promise<Page>,
  openPlayer: () => Promise<Page>
): Promise<{ management: Page; host: Page; guest: Page }> {
  const management = await openManagement();
  const host = await openPlayer();
  await expect(host.getByText(NO_DRAFT_MESSAGE)).toBeVisible();
  await createDraft(management);
  await joinDraft(host, "Alice");
  const guest = await openPlayer();
  await joinDraft(guest, "Bob");
  await management.getByRole("button", { name: "Start picking" }).click();
  return { management, host, guest };
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

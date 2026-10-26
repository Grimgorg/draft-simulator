import { expect, test } from "../fixtures.js";
import { joinDraft, NO_DRAFT_MESSAGE, packCards, panel, pickFirstCard, expectPoolSize } from "../helpers.js";

test("the host creates a Reality Fracture draft and every player opens a 14-card booster", async ({
  openManagement,
  openPlayer,
}) => {
  const management = await openManagement();
  const host = await openPlayer();
  await expect(host.getByText(NO_DRAFT_MESSAGE)).toBeVisible();

  await management.getByRole("button", { name: "Create draft" }).click();
  const dialog = management.getByRole("dialog", { name: "New draft" });
  await dialog.getByLabel("Draft from").selectOption({ label: "Reality Fracture boosters" });
  await expect(dialog.getByLabel("CubeCobra cube URL or ID")).toBeHidden();
  await expect(dialog.getByLabel("Cards per pack")).toBeHidden();
  await dialog.getByRole("button", { name: "Start draft" }).click();
  await expect(dialog).toBeHidden();
  await expect(panel(management, "Current draft").getByText("Reality Fracture (")).toBeVisible();
  await expect(panel(management, "Current draft").getByText("3 per player, 14 cards each")).toBeVisible();

  await joinDraft(host, "Alice");
  const guest = await openPlayer();
  await joinDraft(guest, "Bob");
  await management.getByRole("button", { name: "Start picking" }).click();

  for (const page of [host, guest]) {
    await expect(page.getByRole("heading", { name: "Pack 1 of 3, pick 1" })).toBeVisible();
    await expect(packCards(page)).toHaveCount(14);
  }
  await pickFirstCard(host);
  await expectPoolSize(host, 1);
});

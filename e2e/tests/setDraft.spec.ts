import { expect, test } from "../fixtures.js";
import {
  expectPoolSize,
  joinDraft,
  NO_DRAFT_MESSAGE,
  openNewDraftDialog,
  packCards,
  pickFirstCard,
} from "../helpers.js";

test("a player creates a Reality Fracture draft and every player opens a 14-card booster", async ({ openPlayer }) => {
  const host = await openPlayer();
  await expect(host.getByText(NO_DRAFT_MESSAGE)).toBeVisible();

  const dialog = await openNewDraftDialog(host, "Normal draft", "Set draft");
  await expect(dialog.getByLabel("Set")).toHaveValue("fra");
  await dialog.getByLabel("Set").selectOption({ label: "Reality Fracture" });
  await expect(dialog.getByLabel("CubeCobra cube URL or ID")).toBeHidden();
  await expect(dialog.getByLabel("Cards per pack")).toBeHidden();
  await dialog.getByLabel("Your name").fill("Alice");
  await dialog.getByRole("button", { name: "Create draft" }).click();
  await expect(dialog).toBeHidden();
  await expect(host.getByRole("heading", { name: "Reality Fracture" })).toBeVisible();
  await expect(host.getByText(/3 packs of 14/)).toBeVisible();

  await host.getByRole("button", { name: "Open a sample pack" }).click();
  const samplePack = host.getByRole("dialog", { name: "Reality Fracture" });
  await expect(samplePack.getByRole("img")).toHaveCount(14);
  await samplePack.getByRole("button", { name: "Open another" }).click();
  await expect(samplePack.getByRole("button", { name: "Open another" })).toBeEnabled();
  await expect(samplePack.getByRole("img")).toHaveCount(14);
  await samplePack.getByRole("button", { name: "Close sample pack" }).click();
  await expect(samplePack).toBeHidden();

  const guest = await openPlayer();
  await joinDraft(guest, "Bob", "Reality Fracture");
  await host.getByRole("button", { name: "Start picking" }).click();

  for (const page of [host, guest]) {
    await expect(page.getByRole("heading", { name: "Pack 1 of 3, pick 1" })).toBeVisible();
    await expect(packCards(page)).toHaveCount(14);
  }
  await pickFirstCard(host);
  await expectPoolSize(host, 1);
});

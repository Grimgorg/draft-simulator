import { once } from "node:events";
import fs from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { CUBE_ID, CUBE_NAME, UNRESOLVED_CUBE_ID, expect, test } from "../fixtures.js";
import {
  NO_DRAFT_MESSAGE,
  RECONNECT_TIMEOUT,
  createDraft,
  expectPoolSize,
  joinDraft,
  openNewDraftDialog,
  openTab,
  panel,
  pickFirstCard,
  startTwoPlayerDraft,
} from "../helpers.js";

test("the host watches players create, join and start drafts", async ({ openManagement, openPlayer, draftServer }) => {
  const management = await openManagement();
  const port = new URL(draftServer.url).port;
  await expect(panel(management, "Server")).toContainText(`Running on port ${port}`);
  await expect(panel(management, "Invite players")).toContainText(`http://localhost:${port}`);
  await openTab(management, "Logs");
  await expect(management.getByRole("log")).toContainText(`Draft server is running on port ${port}.`);
  await openTab(management, "Draft");
  const drafts = panel(management, "Drafts");
  await expect(drafts).toContainText("No drafts yet.");

  const host = await openPlayer();
  await expect(host.getByText(NO_DRAFT_MESSAGE)).toBeVisible();
  await createDraft(host, "Alice");
  await expect(drafts).toContainText(CUBE_NAME);
  await expect(drafts).toContainText("Waiting for players");
  await expect(drafts.getByRole("listitem").filter({ hasText: /^Alice/ })).toHaveText(/Alice\s*Connected\s*Creator/);
  await expect(host.getByRole("button", { name: "Waiting for players (1 of at least 2)" })).toBeDisabled();

  const guest = await openPlayer();
  await joinDraft(guest, "Bob");
  await expect(drafts.getByRole("listitem").filter({ hasText: /^Bob/ })).toHaveText(/Bob\s*Connected/);
  await expect(drafts).toContainText("2 browsers connected");

  await host.getByRole("button", { name: "Start picking" }).click();
  await expect(drafts).toContainText("Drafting");

  await guest.close();
  await expect(drafts.getByRole("listitem").filter({ hasText: /^Bob/ })).toContainText("Disconnected");
});

test("a new lobby password applies after a restart, and players are asked for it", async ({
  openManagement,
  openPlayer,
}) => {
  const management = await openManagement();
  const player = await openPlayer();
  await expect(player.getByText(NO_DRAFT_MESSAGE)).toBeVisible();

  await openTab(management, "Settings");
  const settings = panel(management, "Settings");
  await settings.getByLabel("Lobby password").fill("hunter2");
  await settings.getByRole("button", { name: "Save settings" }).click();
  await expect(settings).toContainText("restart it to use the new ones");
  await openTab(management, "Draft");
  await expect(panel(management, "Invite players")).toContainText("No lobby password");

  await openTab(management, "Settings");
  await settings.getByRole("button", { name: "Restart now" }).click();
  await expect(settings).not.toContainText("restart it to use the new ones");
  await openTab(management, "Draft");
  await expect(panel(management, "Invite players")).toContainText("hunter2");

  await expect(player.getByText("This server requires a password to connect.")).toBeVisible({
    timeout: RECONNECT_TIMEOUT,
  });
  await player.getByLabel("Password").fill("hunter2");
  await player.getByRole("button", { name: "Connect" }).click();
  await expect(player.getByText(NO_DRAFT_MESSAGE)).toBeVisible();
});

test("a stopped server keeps the draft, and players get their seat back once it starts", async ({
  openManagement,
  openPlayer,
}) => {
  const management = await openManagement();
  const host = await openPlayer();
  await createDraft(host, "Alice");
  const alice = panel(management, "Drafts").getByRole("listitem").filter({ hasText: /^Alice/ });

  const server = panel(management, "Server");
  await server.getByRole("button", { name: "Stop server" }).click();
  await server.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(server).toContainText("Stopped. Players can't connect");
  await expect(host.getByText("Connecting to server...")).toBeVisible();
  await expect(alice).toContainText("Disconnected");

  await server.getByRole("button", { name: "Start server" }).click();
  await expect(server).toContainText("Running on port");
  await expect(host.getByRole("heading", { name: CUBE_NAME })).toBeVisible({ timeout: RECONNECT_TIMEOUT });
  await expect(host.getByRole("button", { name: /^Waiting for players/ })).toBeVisible();
  await expect(alice).toHaveText(/Alice\s*Connected/);
});

test("a busy port is reported in the management UI, and another port can be chosen", async ({
  openManagement,
  draftServer,
}) => {
  // Held on every interface like the draft server's own: on macOS a port
  // held only on 127.0.0.1 can still be opened on every interface.
  const blocker = createServer().listen(0, "0.0.0.0");
  await once(blocker, "listening");
  try {
    const busyPort = String((blocker.address() as AddressInfo).port);
    const management = await openManagement();

    await openTab(management, "Settings");
    const settings = panel(management, "Settings");
    await settings.getByLabel("Port").fill(busyPort);
    await settings.getByRole("button", { name: "Save settings" }).click();
    await settings.getByRole("button", { name: "Restart now" }).click();

    await expect(management.getByText("Not running")).toBeVisible();
    // The failure is logged as an error, which the hidden Logs tab counts. Other errors could add to the count.
    await expect(management.getByRole("tab", { name: /^Logs\s*\d+$/ })).toBeVisible();
    await openTab(management, "Logs");
    const log = management.getByRole("log");
    await management.getByRole("button", { name: /^Warnings and errors/ }).click();
    await expect(log).toContainText(`Port ${busyPort} is already in use`);
    await expect(log).not.toContainText("Draft server is running");
    await management.getByRole("button", { name: "All", exact: true }).click();
    await expect(log).toContainText("Draft server is running");
    await openTab(management, "Draft");
    await expect(panel(management, "Server")).toContainText(`Port ${busyPort} is already in use`);

    const originalPort = new URL(draftServer.url).port;
    await openTab(management, "Settings");
    await settings.getByLabel("Port").fill(originalPort);
    await settings.getByRole("button", { name: "Save settings" }).click();
    await openTab(management, "Draft");
    await panel(management, "Server").getByRole("button", { name: "Start server" }).click();
    await expect(panel(management, "Server")).toContainText(`Running on port ${originalPort}`);
  } finally {
    blocker.close();
  }
});

test("the tabs show one section at a time and flag what needs a look", async ({ openManagement, draftServer }) => {
  const management = await openManagement();
  const port = new URL(draftServer.url).port;
  // The open buttons aren't clicked: they'd open a real browser window. The server's tests cover them.
  await expect(panel(management, "Invite players").getByRole("button", { name: "Open in browser" })).toBeVisible();
  await expect(panel(management, "Settings")).toBeHidden();
  await expect(management.getByRole("log")).toBeHidden();

  await openTab(management, "Settings");
  await expect(panel(management, "Server")).toBeHidden();
  const settings = panel(management, "Settings");
  await settings.getByLabel("Lobby password").fill("unsaved");
  await openTab(management, "Logs");
  await expect(management.getByRole("log")).toContainText(`Draft server is running on port ${port}.`);
  await openTab(management, "Settings");
  await expect(settings.getByLabel("Lobby password")).toHaveValue("unsaved");

  await settings.getByRole("button", { name: "Save settings" }).click();
  await expect(management.getByRole("tab", { name: /^Settings\s*Restart required$/ })).toBeVisible();

  const { version } = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  await expect(management.getByRole("contentinfo")).toContainText(`Draft Simulator v${version}`);
  await expect(management.getByRole("contentinfo")).toContainText("https://github.com/Grimgorg/draft-simulator");
});

test("the create-draft dialog can be dismissed, and stays open to show a failed import", async ({ openPlayer }) => {
  const player = await openPlayer();
  const dialog = player.getByRole("dialog", { name: "New draft" });

  // First the format, then the type, as image buttons named by the label below them.
  await player.getByRole("button", { name: "Create draft" }).click();
  await expect(dialog.getByText("Normal draft")).toBeVisible();
  await expect(dialog.getByText("Winston draft")).toBeVisible();
  await dialog.getByRole("button", { name: "Normal draft" }).click();
  await expect(dialog.getByText("Cube draft")).toBeVisible();
  await expect(dialog.getByText("Set draft")).toBeVisible();
  await dialog.getByRole("button", { name: "Back" }).click();
  await expect(dialog.getByText("Winston draft")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  await openNewDraftDialog(player, "Normal draft", "Set draft");
  await expect(dialog.getByLabel("Set")).toBeVisible();
  await expect(dialog.getByLabel("Cards per pack")).toBeHidden();
  await dialog.getByRole("button", { name: "Back" }).click();
  await dialog.getByRole("button", { name: "Cube draft" }).click();
  await expect(dialog.getByLabel("Set")).toBeHidden();
  await expect(dialog.getByLabel("Packs per player")).toHaveValue("3");
  await expect(dialog.getByLabel("Cards per pack")).toHaveValue("15");
  await expect(dialog.getByLabel("Alternate pack direction each round")).toBeChecked();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  await player.getByRole("button", { name: "Create draft" }).click();
  await expect(dialog).toBeVisible();
  await player.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(player.getByText(NO_DRAFT_MESSAGE)).toBeVisible();

  await openNewDraftDialog(player, "Normal draft", "Cube draft");
  await dialog.getByLabel("Your name").fill("Alice");
  await dialog.getByLabel("CubeCobra cube URL or ID").fill("no-such-cube");
  await dialog.getByRole("button", { name: "Create draft" }).click();
  await expect(dialog.getByRole("alert")).toContainText('Could not fetch cube "no-such-cube" from CubeCobra: 404');
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("CubeCobra cube URL or ID").fill(CUBE_ID);
  await dialog.getByRole("button", { name: "Create draft" }).click();
  await expect(dialog).toBeHidden();
  await expect(player.getByRole("heading", { name: CUBE_NAME })).toBeVisible();
  await expect(player.getByRole("button", { name: "Waiting for players (1 of at least 2)" })).toBeVisible();
});

test("the host can cancel any draft from the management UI, after a confirmation, and its players are told", async ({
  openManagement,
  openPlayer,
}) => {
  const management = await openManagement();
  const { host, guest } = await startTwoPlayerDraft(openPlayer);
  const drafts = panel(management, "Drafts");
  await pickFirstCard(host);
  await expectPoolSize(host, 1);

  await drafts.getByRole("button", { name: "Cancel draft" }).click();
  await drafts.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(drafts.getByRole("button", { name: "Cancel draft" })).toBeVisible();
  await expect(drafts).toContainText("Drafting");

  await drafts.getByRole("button", { name: "Cancel draft" }).click();
  await drafts.getByRole("button", { name: "Yes, cancel draft" }).click();
  await expect(drafts).toContainText("No drafts yet.");
  for (const page of [host, guest]) {
    await expect(page.getByText("Your draft was closed by its creator or the host.")).toBeVisible();
    await page.getByRole("button", { name: "Back to the drafts" }).click();
    await expect(page.getByText(NO_DRAFT_MESSAGE)).toBeVisible();
  }
});

test("a guest can leave a draft before it starts, and its creator can cancel it", async ({ openPlayer }) => {
  const host = await openPlayer();
  await createDraft(host, "Alice");
  const guest = await openPlayer();
  await joinDraft(guest, "Bob");
  await expect(host.getByRole("button", { name: "Start picking" })).toBeEnabled();
  await expect(guest.getByRole("button", { name: "Cancel draft" })).toHaveCount(0);

  await guest.getByRole("button", { name: "Leave draft" }).click();
  await expect(guest.getByRole("heading", { name: "Drafts" })).toBeVisible();
  await expect(host.getByRole("button", { name: "Waiting for players (1 of at least 2)" })).toBeDisabled();
  await joinDraft(guest, "Bob");

  await host.getByRole("button", { name: "Cancel draft" }).click();
  await host.getByRole("button", { name: "Yes, cancel draft" }).click();
  await expect(host.getByText(NO_DRAFT_MESSAGE)).toBeVisible();
  await expect(guest.getByText("Your draft was closed by its creator or the host.")).toBeVisible();
});

test("cards missing from the card database are reported", async ({ openPlayer }) => {
  const player = await openPlayer();
  await createDraft(player, "Alice", UNRESOLVED_CUBE_ID);
  await expect(player.getByText("1 card(s) from this cube couldn't be found and were skipped: Not A Real Card")).toBeVisible();
});

test("invalid settings are refused with the reason", async ({ openManagement, draftServer }) => {
  const management = await openManagement();
  await openTab(management, "Settings");
  const settings = panel(management, "Settings");
  const port = settings.getByLabel("Port");
  const save = settings.getByRole("button", { name: "Save settings" });
  await expect(save).toBeDisabled();

  await port.fill("0");
  await save.click();
  await expect(settings.getByRole("alert")).toHaveText("The port must be a whole number from 1 to 65535.");

  const managementPort = new URL(draftServer.managementUrl).port;
  await port.fill(managementPort);
  await save.click();
  await expect(settings.getByRole("alert")).toHaveText(
    `Port ${managementPort} is the management UI's own port. Choose a different port for players.`
  );

  await port.fill(new URL(draftServer.url).port);
  await expect(save).toBeDisabled();
  await settings.getByLabel("Lobby password").fill('say "hi"');
  await save.click();
  await expect(settings.getByRole("alert")).toContainText("The password can't contain quotes");
  await expect(management.getByRole("tab", { name: /^Settings$/ })).toBeVisible();
});

test("a copy button puts its address on the clipboard", async ({ openManagement, draftServer }) => {
  const management = await openManagement();
  await management.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const copy = panel(management, "Invite players").getByRole("button", { name: "Copy On this computer" });
  await copy.click();
  await expect(copy).toHaveText("Copied");
  expect(await management.evaluate(() => navigator.clipboard.readText())).toBe(
    `http://localhost:${new URL(draftServer.url).port}`
  );
});

test("restarting during a draft needs a confirmation, and players keep their seat", async ({
  openManagement,
  openPlayer,
}) => {
  const management = await openManagement();
  const host = await openPlayer();
  await createDraft(host, "Alice");
  const server = panel(management, "Server");

  await server.getByRole("button", { name: "Restart server" }).click();
  await server.getByRole("button", { name: "Cancel", exact: true }).click();
  await server.getByRole("button", { name: "Restart server" }).click();
  await server.getByRole("button", { name: "Restart", exact: true }).click();

  // The second start in the log shows that the server really restarted.
  await openTab(management, "Logs");
  await expect(management.getByRole("log").getByText(/Draft server is running on port/)).toHaveCount(2);
  await openTab(management, "Draft");
  await expect(panel(management, "Drafts").getByRole("listitem").filter({ hasText: /^Alice/ })).toHaveText(
    /Alice\s*Connected/,
    { timeout: RECONNECT_TIMEOUT },
  );
  await expect(host.getByRole("button", { name: /^Waiting for players/ })).toBeVisible();
});

import { once } from "node:events";
import fs from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import type { Page } from "@playwright/test";
import { CUBE_ID, CUBE_NAME, expect, test } from "../fixtures.js";

// A browser's socket waits up to 5s between reconnect attempts, so coming
// back after a stop or restart can take that long.
const RECONNECT_TIMEOUT = 15_000;

async function createDraft(host: Page): Promise<void> {
  await host.getByLabel("Your name").fill("Alice");
  await host.getByLabel("CubeCobra cube URL or ID").fill(CUBE_ID);
  await host.getByLabel("Number of players").fill("2");
  await host.getByLabel("Packs per player").fill("2");
  await host.getByLabel("Cards per pack").fill("2");
  await host.getByRole("button", { name: "Create draft" }).click();
  await expect(host.getByRole("heading", { name: CUBE_NAME })).toBeVisible();
}

function panel(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

/** Panels on other tabs are hidden, so getByRole doesn't find them. */
async function openTab(page: Page, name: "Draft" | "Settings" | "Logs"): Promise<void> {
  await page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
}

test("the host watches players join and the draft start", async ({ openManagement, openPlayer, draftServer }) => {
  const management = await openManagement();
  const port = new URL(draftServer.url).port;
  await expect(panel(management, "Server")).toContainText(`Running on port ${port}`);
  await expect(panel(management, "Invite players")).toContainText(`http://localhost:${port}`);
  await openTab(management, "Logs");
  await expect(management.getByRole("log")).toContainText(`Draft server is running on port ${port}.`);
  await openTab(management, "Draft");

  const host = await openPlayer();
  await createDraft(host);
  await expect(panel(management, "Current draft")).toContainText("Waiting for players to join.");
  await expect(panel(management, "Current draft")).toContainText(`${CUBE_NAME} (8 cards)`);
  await expect(panel(management, "Players").getByRole("listitem")).toHaveText([/Alice\s*Host\s*Connected/]);

  const guest = await openPlayer();
  await guest.getByLabel("Your name").fill("Bob");
  await guest.getByRole("button", { name: "Join draft" }).click();
  await expect(panel(management, "Players").getByRole("listitem")).toHaveText([/Alice/, /Bob\s*Connected/]);
  await expect(panel(management, "Players")).toContainText("2 browsers connected");

  await host.getByRole("button", { name: "Start draft" }).click();
  await expect(panel(management, "Current draft")).toContainText("Pack 1 of 2, pick 1 of 2");
  await expect(panel(management, "Players").getByText("Picking")).toHaveCount(2);

  await guest.close();
  await expect(panel(management, "Players").getByRole("listitem").filter({ hasText: "Bob" })).toContainText(
    "Disconnected",
  );
});

test("a new lobby password applies after a restart, and players are asked for it", async ({
  openManagement,
  openPlayer,
}) => {
  const management = await openManagement();
  const player = await openPlayer();
  await expect(player.getByLabel("Your name")).toBeVisible();

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
  await expect(player.getByLabel("Your name")).toBeVisible();
});

test("a stopped server keeps the draft, and players get their seat back once it starts", async ({
  openManagement,
  openPlayer,
}) => {
  const management = await openManagement();
  const host = await openPlayer();
  await createDraft(host);

  const server = panel(management, "Server");
  await server.getByRole("button", { name: "Stop server" }).click();
  await server.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(server).toContainText("Stopped. Players can't connect");
  await expect(host.getByText("Connecting to server...")).toBeVisible();
  await expect(panel(management, "Players").getByRole("listitem")).toHaveText([/Alice\s*Host\s*Disconnected/]);

  await server.getByRole("button", { name: "Start server" }).click();
  await expect(server).toContainText("Running on port");
  await expect(host.getByRole("heading", { name: CUBE_NAME })).toBeVisible({ timeout: RECONNECT_TIMEOUT });
  await expect(panel(management, "Players").getByRole("listitem")).toHaveText([/Alice\s*Host\s*Connected/]);
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

// What the host sees in the console once the server is up: how to open it,
// which port friends outside the network need forwarded (Socket.IO shares
// the HTTP port, so it's just the one), and the password to hand out.

export interface StartupBannerOptions {
  port: number;
  lobbyPassword: string | undefined;
  envFilePath: string;
}

export function buildStartupBanner({ port, lobbyPassword, envFilePath }: StartupBannerOptions): string {
  const password = lobbyPassword ? lobbyPassword : "none (anyone who can reach this port can join)";
  return [
    `Draft Simulator is running on port ${port}.`,
    `  Open http://localhost:${port} on this PC.`,
    `  For friends outside your network, forward TCP port ${port} on your router to this PC.`,
    `  Lobby password: ${password}`,
    `To change the port or the password, edit ${envFilePath} and restart.`,
  ].join("\n");
}

export function buildPortInUseMessage(port: number, envFilePath: string): string {
  return (
    `Port ${port} is already in use. Is another copy of Draft Simulator running? ` +
    `Close it, or set a different PORT in ${envFilePath} and restart.`
  );
}

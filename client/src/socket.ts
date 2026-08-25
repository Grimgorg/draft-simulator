import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@draft-simulator/shared";
import { getStoredPassword } from "./lobbyPassword.js";

// In production the server serves this app's built files itself, so the
// socket connection and card images are same-origin. In dev, the client
// runs on Vite's own port and needs to be told where the backend is
// (see .env.development).
export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? window.location.origin;

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
  auth: { password: getStoredPassword() ?? "" },
});

export function resolveImageUrl(path: string): string {
  return `${SERVER_URL}${path}`;
}

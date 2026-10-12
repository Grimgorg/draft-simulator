import type { Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@draft-simulator/shared";

/**
 * Optional shared password gating the actual draft (the socket connection),
 * for when the server is exposed beyond a trusted LAN. Unset by default —
 * no password required. "invalid_password" is a machine-checkable marker
 * the client uses to show a password prompt rather than a generic error.
 */
export function requireLobbyPassword(password: string | undefined) {
  return (socket: Socket<ClientToServerEvents, ServerToClientEvents>, next: (err?: Error) => void): void => {
    if (!password || socket.handshake.auth?.password === password) {
      next();
    } else {
      next(new Error("invalid_password"));
    }
  };
}

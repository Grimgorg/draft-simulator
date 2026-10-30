import { createHash, timingSafeEqual } from "node:crypto";
import type { Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@draft-simulator/shared";
import { clientAddress } from "../limits/clientAddress.js";
import { createWindowCounter } from "../limits/windowCounter.js";

/**
 * Wrong passwords an address may try before it's refused for the rest of ATTEMPT_WINDOW_MS. Without a limit, a
 * server exposed to the internet let anyone guess the lobby password as fast as they could connect.
 */
const MAX_WRONG_PASSWORDS = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

function sha256(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}

/**
 * Compared as hashes: timingSafeEqual needs inputs of equal length, and comparing the strings themselves with ===
 * stops at the first differing character, which in principle tells a patient attacker how much of a guess was right.
 */
function isRightPassword(given: unknown, password: string): boolean {
  return typeof given === "string" && timingSafeEqual(sha256(given), sha256(password));
}

/**
 * Optional shared password gating the actual draft (the socket connection),
 * for when the server is exposed beyond a trusted LAN. Unset by default —
 * no password required. "invalid_password" is a machine-checkable marker
 * the client uses to show a password prompt rather than a generic error;
 * "too_many_attempts" tells it this address has to wait.
 *
 * While an address is refused, the right password is refused too: otherwise
 * guessing could go on, and a guess that got in would show it was right.
 */
export function requireLobbyPassword(password: string | undefined, now: () => number = Date.now) {
  const wrongPasswords = createWindowCounter(ATTEMPT_WINDOW_MS, now);
  return (socket: Socket<ClientToServerEvents, ServerToClientEvents>, next: (err?: Error) => void): void => {
    if (!password) {
      next();
      return;
    }
    const address = clientAddress(socket.handshake.address, socket.handshake.headers);
    if (wrongPasswords.count(address) >= MAX_WRONG_PASSWORDS) {
      next(new Error("too_many_attempts"));
      return;
    }
    const given: unknown = socket.handshake.auth?.password;
    if (isRightPassword(given, password)) {
      wrongPasswords.reset(address);
      next();
      return;
    }
    // A first visit sends no password yet: that's not a guess, and friends behind one router opening the page
    // mustn't lock each other out.
    if (given !== "" && given !== undefined) wrongPasswords.add(address);
    next(new Error("invalid_password"));
  };
}

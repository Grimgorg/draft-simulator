import { timingSafeEqual } from "node:crypto";
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

/**
 * Compared in constant time: === stops at the first differing character, which in principle tells a patient
 * attacker how much of a guess was right. timingSafeEqual needs inputs of equal length, so both are padded to the
 * longer one, and the lengths compared after. (Hashing them to equal length instead made CodeQL report the password
 * as stored with a weak hash, though nothing is stored.)
 */
function isRightPassword(given: unknown, password: string): boolean {
  if (typeof given !== "string") return false;
  const givenBytes = Buffer.from(given);
  const passwordBytes = Buffer.from(password);
  const length = Math.max(givenBytes.length, passwordBytes.length);
  const paddedGiven = Buffer.alloc(length);
  const paddedPassword = Buffer.alloc(length);
  givenBytes.copy(paddedGiven);
  passwordBytes.copy(paddedPassword);
  return timingSafeEqual(paddedGiven, paddedPassword) && givenBytes.length === passwordBytes.length;
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

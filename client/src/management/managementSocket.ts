import { io, type Socket } from "socket.io-client";
import type { ManagementClientToServerEvents, ManagementServerToClientEvents } from "@draft-simulator/shared";

// The management server serves this page itself, so the socket is
// same-origin. In dev the page comes from Vite's own port and needs to be
// told where the management server is (see .env.development).
const MANAGEMENT_URL = import.meta.env.VITE_MANAGEMENT_URL ?? window.location.origin;

// Not connected here: useManagementConnection connects it once its listeners
// are attached, so the first manage:state can't be missed.
export const managementSocket: Socket<ManagementServerToClientEvents, ManagementClientToServerEvents> = io(
  MANAGEMENT_URL,
  { autoConnect: false },
);

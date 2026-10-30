import { useState } from "react";
import type { DraftStatus } from "@draft-simulator/shared";
import { socket } from "../socket.js";
import { ConfirmButton } from "./ConfirmButton.js";

// Like a pick's, so a lost acknowledgement can't leave the button disabled until the page is reloaded.
const ACK_TIMEOUT_MS = 10_000;
const NO_RESPONSE = "The server didn't respond. Please try again.";

/** Sends one of the seat's draft actions and tracks it until the server answers. */
function useDraftAction(event: "lobby:leave" | "draft:close", onDone: () => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function run() {
    setPending(true);
    setError(null);
    socket.timeout(ACK_TIMEOUT_MS).emit(event, (err, result) => {
      setPending(false);
      if (err) return setError(NO_RESPONSE);
      if (!result.ok) return setError(result.error);
      onDone();
    });
  }
  return { pending, error, run };
}

interface LeaveDraftButtonProps {
  label: string;
  /** Called once the server has freed the seat. */
  onLeft: () => void;
}

/** Gives up this browser's seat: before the draft starts, or once it's over to go back to the draft list. */
export function LeaveDraftButton({ label, onLeft }: LeaveDraftButtonProps) {
  const { pending, error, run } = useDraftAction("lobby:leave", onLeft);
  return (
    <>
      <button type="button" className="secondary-button" disabled={pending} onClick={run}>
        {label}
      </button>
      {error && <p className="error">{error}</p>}
    </>
  );
}

interface CloseDraftButtonProps {
  status: DraftStatus;
  /** Called once the draft is closed: its creator's seat is gone with it. */
  onClosed: () => void;
}

/** The creator's way to end the draft for everyone. Before it's finished that's cancelling it. */
export function CloseDraftButton({ status, onClosed }: CloseDraftButtonProps) {
  const { pending, error, run } = useDraftAction("draft:close", onClosed);
  const finished = status === "complete";
  return (
    <>
      <ConfirmButton
        label={finished ? "Close draft" : "Cancel draft"}
        className="danger-button"
        confirmMessage={
          finished
            ? "Close this draft? It's removed for everyone, with their pools and decks."
            : "Cancel this draft? Everyone is removed and all picks are lost. This can't be undone."
        }
        confirmLabel={finished ? "Yes, close draft" : "Yes, cancel draft"}
        disabled={pending}
        onConfirm={run}
      />
      {error && <p className="error">{error}</p>}
    </>
  );
}

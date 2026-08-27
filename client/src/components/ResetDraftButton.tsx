import { useState } from "react";
import { socket } from "../socket.js";
import { ConfirmButton } from "./ConfirmButton.js";

export function ResetDraftButton() {
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleReset() {
    setResetting(true);
    setError(null);
    socket.emit("lobby:reset", (result) => {
      setResetting(false);
      if (!result.ok) setError(result.error);
      // On success the server broadcasts the now-empty lobby state, and the
      // app swaps to the ordinary host setup screen on its own — no local
      // state to flip here.
    });
  }

  return (
    <div className="new-draft-section">
      <ConfirmButton
        label="Start a new draft"
        pendingLabel="Starting..."
        confirmMessage="This ends the current draft for everyone and clears it from the server."
        confirmLabel="Yes, start a new draft"
        disabled={resetting}
        onConfirm={handleReset}
      />
      {error && <p className="error">{error}</p>}
    </div>
  );
}

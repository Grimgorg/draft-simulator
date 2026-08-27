import { useState } from "react";
import { socket } from "../socket.js";
import { ConfirmButton } from "./ConfirmButton.js";

export function CancelDraftButton() {
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCancel() {
    setCancelling(true);
    setError(null);
    socket.emit("draft:cancel", (result) => {
      setCancelling(false);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="cancel-draft">
      <ConfirmButton
        label="Cancel draft"
        pendingLabel="Cancelling..."
        className="cancel-draft-button"
        confirmMessage="Cancel this draft? Everyone will be removed and all progress will be lost. This cannot be undone."
        confirmLabel="Yes, cancel draft"
        disabled={cancelling}
        onConfirm={handleCancel}
      />
      {error && <p className="error">{error}</p>}
    </div>
  );
}

import { useState } from "react";
import { socket } from "../socket.js";

export function CancelDraftButton() {
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCancel() {
    const confirmed = window.confirm(
      "Cancel this draft? Everyone will be removed and all progress will be lost. This cannot be undone.",
    );
    if (!confirmed) return;

    setCancelling(true);
    setError(null);
    socket.emit("draft:cancel", (result) => {
      setCancelling(false);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="cancel-draft">
      <button type="button" className="cancel-draft-button" onClick={handleCancel} disabled={cancelling}>
        {cancelling ? "Cancelling..." : "Cancel draft"}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

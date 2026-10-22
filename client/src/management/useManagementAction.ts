import { useCallback, useState } from "react";
import type { ActionResult } from "@draft-simulator/shared";

export interface ManagementAction {
  pending: boolean;
  error: string | null;
  /** Sends one request and tracks it until the server answers. */
  run: (send: (callback: (result: ActionResult) => void) => void, onSuccess?: () => void) => void;
}

/** The pending flag and error message for a button that sends a request to the management server. */
export function useManagementAction(): ManagementAction {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback<ManagementAction["run"]>((send, onSuccess) => {
    setPending(true);
    setError(null);
    send((result) => {
      setPending(false);
      if (result.ok) onSuccess?.();
      else setError(result.error);
    });
  }, []);

  return { pending, error, run };
}

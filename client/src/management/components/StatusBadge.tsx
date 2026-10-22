import type { DraftServerStatus } from "@draft-simulator/shared";

const LABELS: Record<DraftServerStatus, string> = {
  stopped: "Stopped",
  starting: "Starting",
  running: "Running",
  stopping: "Stopping",
  failed: "Not running",
};

interface StatusBadgeProps {
  status: DraftServerStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`status-badge status-${status}`}>
      <span className="status-dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}

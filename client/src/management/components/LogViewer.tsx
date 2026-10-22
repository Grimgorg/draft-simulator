import { useLayoutEffect, useRef, useState } from "react";
import type { LogEntry } from "@draft-simulator/shared";

interface LogViewerProps {
  entries: LogEntry[];
  /** False while its tab is hidden, where scrolling to the latest line does nothing. */
  visible: boolean;
}

/** How close to the bottom still counts as reading the latest lines, so a pixel of rounding doesn't stop following. */
const FOLLOW_THRESHOLD_PX = 24;

function formatTime(time: number): string {
  return new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function LogViewer({ entries, visible }: LogViewerProps) {
  const [problemsOnly, setProblemsOnly] = useState(false);
  // Follows new lines until the host scrolls up to read older ones.
  const [following, setFollowing] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const problemCount = entries.filter((entry) => entry.level !== "info").length;
  const shown = problemsOnly ? entries.filter((entry) => entry.level !== "info") : entries;

  useLayoutEffect(() => {
    const list = listRef.current;
    if (following && visible && list) list.scrollTop = list.scrollHeight;
  }, [shown, following, visible]);

  function onScroll() {
    const list = listRef.current;
    if (!list) return;
    setFollowing(list.scrollHeight - list.scrollTop - list.clientHeight < FOLLOW_THRESHOLD_PX);
  }

  return (
    <section className="panel log-panel" aria-labelledby="log-heading">
      <div className="log-toolbar">
        <h2 id="log-heading">Log</h2>
        <div className="log-filters">
          <button type="button" aria-pressed={!problemsOnly} onClick={() => setProblemsOnly(false)}>
            All
          </button>
          <button type="button" aria-pressed={problemsOnly} onClick={() => setProblemsOnly(true)}>
            Warnings and errors ({problemCount})
          </button>
        </div>
      </div>
      <div className="log-list" ref={listRef} onScroll={onScroll} role="log" aria-label="Server log">
        {shown.length === 0 && (
          <p className="muted">{problemsOnly ? "No warnings or errors." : "Nothing logged yet."}</p>
        )}
        {shown.map((entry) => (
          <div key={entry.id} className={`log-entry log-${entry.level}`}>
            <time dateTime={new Date(entry.time).toISOString()}>{formatTime(entry.time)}</time>
            <span className="log-level">{entry.level === "info" ? "" : entry.level === "warn" ? "Warning" : "Error"}</span>
            <pre>{entry.message}</pre>
          </div>
        ))}
      </div>
      {!following && (
        <button type="button" className="log-jump" onClick={() => setFollowing(true)}>
          Jump to latest
        </button>
      )}
    </section>
  );
}

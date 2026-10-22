import { format } from "node:util";
import type { LogEntry, LogLevel } from "@draft-simulator/shared";

/** Enough to scroll back through a whole draft's connects and disconnects, without growing for as long as the app runs. */
export const MAX_LOG_ENTRIES = 2000;

const entries: LogEntry[] = [];
const listeners = new Set<(entry: LogEntry) => void>();
let nextId = 1;
/** Where a failing listener is reported: the console's own error method, so the report can't loop back here. */
let reportListenerError: (...args: unknown[]) => void = () => {};

export function recordLog(level: LogLevel, message: string): void {
  const entry: LogEntry = { id: nextId++, time: Date.now(), level, message };
  entries.push(entry);
  if (entries.length > MAX_LOG_ENTRIES) entries.shift();
  for (const listener of listeners) {
    // A listener runs inside whatever console call is being logged, and that
    // can be a socket handler that must never throw.
    try {
      listener(entry);
    } catch (err) {
      reportListenerError("A log listener failed:", err);
    }
  }
}

/** The most recent entries, oldest first. */
export function getLogHistory(): LogEntry[] {
  return [...entries];
}

/** Calls `listener` with every new entry; returns a function that stops it. */
export function onLog(listener: (entry: LogEntry) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Records everything logged through `target` while still printing it, so the
 * management UI shows what a terminal would have. util.format is what
 * console uses, so an Error keeps its stack trace.
 */
export function captureConsole(target: Pick<Console, "log" | "info" | "warn" | "error">): void {
  const original = {
    log: target.log.bind(target),
    info: target.info.bind(target),
    warn: target.warn.bind(target),
    error: target.error.bind(target),
  };
  reportListenerError = original.error;
  const levels: Record<keyof typeof original, LogLevel> = { log: "info", info: "info", warn: "warn", error: "error" };
  for (const method of Object.keys(original) as (keyof typeof original)[]) {
    target[method] = (...args: unknown[]) => {
      original[method](...args);
      recordLog(levels[method], format(...args));
    };
  }
}

/** Test-only: empties the buffer. */
export function clearLogsForTests(): void {
  entries.length = 0;
}

interface UnresolvedCardsWarningProps {
  /** Cube card names that couldn't be matched against the server's card database. */
  names: string[];
}

/** Warns which of a cube's cards were skipped on import; renders nothing when all were found. */
export function UnresolvedCardsWarning({ names }: UnresolvedCardsWarningProps) {
  if (names.length === 0) return null;
  return (
    <p className="warning">
      {names.length} card(s) from this cube couldn't be found and were skipped: {names.join(", ")}
    </p>
  );
}

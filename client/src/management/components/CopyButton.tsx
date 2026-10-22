import { useState } from "react";

interface CopyButtonProps {
  text: string;
  /** What's being copied, for screen readers: "Copy <label>". */
  label: string;
}

export function CopyButton({ text, label }: CopyButtonProps) {
  const [result, setResult] = useState<"copied" | "failed" | null>(null);

  function copy() {
    navigator.clipboard.writeText(text).then(
      () => setResult("copied"),
      () => setResult("failed"),
    );
  }

  return (
    <button type="button" className="copy-button" aria-label={`Copy ${label}`} onClick={copy}>
      {result === "copied" ? "Copied" : result === "failed" ? "Couldn't copy" : "Copy"}
    </button>
  );
}

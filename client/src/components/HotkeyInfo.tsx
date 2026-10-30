import { useId } from "react";
import { HOTKEYS } from "../hotkeys.js";

/** A small info button listing the keyboard shortcuts, shown on hover or keyboard focus. */
export function HotkeyInfo() {
  const tooltipId = useId();
  return (
    <span className="hotkey-info">
      <button type="button" className="hotkey-info-button" aria-label="Keyboard shortcuts" aria-describedby={tooltipId}>
        i
      </button>
      <div id={tooltipId} role="tooltip" className="hotkey-tooltip">
        <dl>
          {HOTKEYS.map((hotkey) => (
            <div key={hotkey.keys}>
              <dt>{hotkey.keys}</dt>
              <dd>{hotkey.action}</dd>
            </div>
          ))}
        </dl>
      </div>
    </span>
  );
}

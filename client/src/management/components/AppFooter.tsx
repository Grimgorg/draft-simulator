import { REPOSITORY_URL } from "@draft-simulator/shared";
import { managementSocket } from "../managementSocket.js";
import { useManagementAction } from "../useManagementAction.js";
import { CopyButton } from "./CopyButton.js";

/** The app's version and where its source lives. The address is text, not a link, like the invite addresses. */
export function AppFooter() {
  const open = useManagementAction();

  return (
    <footer className="manage-footer">
      <span>Draft Simulator v{__APP_VERSION__}</span>
      <span className="manage-footer-repo">
        <code>{REPOSITORY_URL}</code>
        <CopyButton text={REPOSITORY_URL} label="repository address" />
        <button
          type="button"
          className="copy-button"
          disabled={open.pending}
          onClick={() => open.run((callback) => managementSocket.emit("manage:openInBrowser", "repository", callback))}
        >
          Open
        </button>
      </span>
      {open.error && (
        <p className="error" role="alert">
          {open.error}
        </p>
      )}
    </footer>
  );
}

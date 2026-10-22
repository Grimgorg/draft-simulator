import type { ReactNode } from "react";
import type { ManagementStateView } from "@draft-simulator/shared";
import { managementSocket } from "../managementSocket.js";
import { useManagementAction } from "../useManagementAction.js";
import { CopyButton } from "./CopyButton.js";

interface InvitePanelProps {
  state: ManagementStateView;
}

interface AddressRowProps {
  label: string;
  value: string;
  children?: ReactNode;
}

// Plain text with a copy button rather than links: in the desktop app, a
// link would replace this page in its only window.
function AddressRow({ label, value, children }: AddressRowProps) {
  return (
    <div className="address-row">
      <dt>{label}</dt>
      <dd>
        <code>{value}</code>
        <CopyButton text={value} label={label} />
        {children}
      </dd>
    </div>
  );
}

/** What the host sends to friends: the addresses to open, the port to forward and the password. */
export function InvitePanel({ state }: InvitePanelProps) {
  const running = state.server.status === "running" ? state.server.running : undefined;
  const open = useManagementAction();

  return (
    <section className="panel" aria-labelledby="invite-heading">
      <h2 id="invite-heading">Invite players</h2>
      {!running ? (
        <p className="muted">Start the server to invite players.</p>
      ) : (
        <>
          <dl className="address-list">
            <AddressRow label="On this computer" value={`http://localhost:${running.port}`}>
              <button
                type="button"
                className="copy-button"
                disabled={open.pending}
                onClick={() => open.run((callback) => managementSocket.emit("manage:openInBrowser", "playerPage", callback))}
              >
                Open in browser
              </button>
            </AddressRow>
            {state.lanAddresses.map((address) => (
              <AddressRow key={address} label="On the same network" value={`http://${address}:${running.port}`} />
            ))}
          </dl>
          {open.error && (
            <p className="error" role="alert">
              {open.error}
            </p>
          )}
          <p className="muted">
            For friends outside your network, forward TCP port {running.port} on your router to this computer, then
            send them <code>http://&lt;your public IP&gt;:{running.port}</code>. Searching "what is my IP" shows your
            public IP.
          </p>
          {running.lobbyPassword ? (
            <dl className="address-list">
              <AddressRow label="Lobby password" value={running.lobbyPassword} />
            </dl>
          ) : (
            <p className="warning">
              No lobby password: anyone who can reach this port can join. Set one in the settings before forwarding the
              port.
            </p>
          )}
        </>
      )}
    </section>
  );
}

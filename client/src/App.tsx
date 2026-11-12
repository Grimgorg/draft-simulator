import { useEffect, useState } from "react";
import "./App.css";
import { CardPreviewProvider } from "./CardPreviewContext.js";
import { CardPreviewOverlay } from "./components/CardPreviewOverlay.js";
import { DraftBoard } from "./components/DraftBoard.js";
import { DraftList } from "./components/DraftList.js";
import { LobbyPasswordScreen } from "./components/LobbyPasswordScreen.js";
import { RejoinScreen } from "./components/RejoinScreen.js";
import { ResultsScreen } from "./components/ResultsScreen.js";
import { WaitingRoom } from "./components/WaitingRoom.js";
import type { StoredSeat } from "./playerIdentity.js";
import { useDraftConnection } from "./useDraftConnection.js";

function StatusScreen({ message, action }: { message: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="screen">
      <h1>Draft Simulator</h1>
      <p className="subtitle">{message}</p>
      {action && (
        <button type="button" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

function AppContent() {
  const {
    connected,
    reconnecting,
    evicted,
    dismissEviction,
    draftClosed,
    dismissDraftClosed,
    drafts,
    seat,
    takeSeat,
    leaveSeat,
    lobbyState,
    myPack,
    myPile,
    myPool,
    passwordRequired,
    passwordError,
    submitPassword,
  } = useDraftConnection();
  /** The draft picked from the list, whose join and rejoin screen shows until this browser takes a seat. */
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);

  function seatTaken(next: StoredSeat) {
    setOpenDraftId(null);
    takeSeat(next);
  }

  // Screens vary wildly in height (a long results/deck-builder page vs. a
  // short waiting room), and React doesn't reset scroll on its own — without
  // this, switching to a shorter screen can leave the viewport scrolled past
  // the end of the new page, making it look blank/unresponsive.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [connected, reconnecting, evicted, draftClosed, passwordRequired, lobbyState?.status, seat, openDraftId]);

  // Checked ahead of the connection screens: eviction force-disconnects the
  // stale socket, so this browser briefly cycles disconnected -> reconnected
  // right after — without this, that flash would hide the notice.
  if (evicted) {
    return (
      <StatusScreen
        message="This player was just claimed from another browser or tab. Continue to pick a draft and a seat again."
        action={{ label: "Continue", onClick: dismissEviction }}
      />
    );
  }
  if (draftClosed) {
    return (
      <StatusScreen
        message="Your draft was closed by its creator or the host."
        action={{ label: "Back to the drafts", onClick: dismissDraftClosed }}
      />
    );
  }
  if (passwordRequired) {
    return <LobbyPasswordScreen error={passwordError} onSubmit={submitPassword} />;
  }
  if (!connected || !drafts) {
    return <StatusScreen message="Connecting to server..." />;
  }
  if (reconnecting) {
    return <StatusScreen message="Reconnecting..." />;
  }

  if (seat) {
    // The seat's draft state follows its acknowledgement right away.
    if (!lobbyState) return <StatusScreen message="Opening the draft..." />;
    if (lobbyState.status === "lobby") {
      return <WaitingRoom lobbyState={lobbyState} myPlayerId={seat.playerId} onLeft={leaveSeat} />;
    }
    if (lobbyState.status === "drafting") {
      return (
        <DraftBoard
          lobbyState={lobbyState}
          myPlayerId={seat.playerId}
          myPack={myPack}
          myPile={myPile}
          myPool={myPool}
          onClosed={leaveSeat}
        />
      );
    }
    // status === "complete"
    return <ResultsScreen lobbyState={lobbyState} myPlayerId={seat.playerId} myPool={myPool} onLeft={leaveSeat} />;
  }

  // A draft closed while its screen was open goes back to the list.
  const openDraft = drafts.find((draft) => draft.draftId === openDraftId);
  if (openDraft) {
    return <RejoinScreen draft={openDraft} onIdentitySelected={seatTaken} onBack={() => setOpenDraftId(null)} />;
  }
  return <DraftList drafts={drafts} onOpen={setOpenDraftId} onCreated={seatTaken} />;
}

function App() {
  return (
    <CardPreviewProvider>
      <AppContent />
      <CardPreviewOverlay />
    </CardPreviewProvider>
  );
}

export default App;

import { useEffect } from "react";
import "./App.css";
import { CardPreviewProvider } from "./CardPreviewContext.js";
import { CardPreviewOverlay } from "./components/CardPreviewOverlay.js";
import { DraftBoard } from "./components/DraftBoard.js";
import { LobbyPasswordScreen } from "./components/LobbyPasswordScreen.js";
import { RejoinScreen } from "./components/RejoinScreen.js";
import { ResultsScreen } from "./components/ResultsScreen.js";
import { WaitingRoom } from "./components/WaitingRoom.js";
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
    lobbyState,
    myPlayerId,
    setMyPlayerId,
    myPack,
    myPool,
    passwordRequired,
    passwordError,
    submitPassword,
  } = useDraftConnection();

  // Screens vary wildly in height (a long results/deck-builder page vs. a
  // short waiting room), and React doesn't reset scroll on its own — without
  // this, switching to a shorter screen can leave the viewport scrolled past
  // the end of the new page, making it look blank/unresponsive.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [connected, reconnecting, evicted, passwordRequired, lobbyState?.status, myPlayerId]);

  // Checked ahead of the connection screens: eviction force-disconnects the
  // stale socket, so this browser briefly cycles disconnected -> reconnected
  // right after — without this, that flash would hide the notice.
  if (evicted) {
    return (
      <StatusScreen
        message="This player was just claimed from another browser or tab. Pick a name below to rejoin."
        action={{ label: "Continue", onClick: dismissEviction }}
      />
    );
  }
  if (passwordRequired) {
    return <LobbyPasswordScreen error={passwordError} onSubmit={submitPassword} />;
  }
  if (!connected) {
    return <StatusScreen message="Connecting to server..." />;
  }
  if (reconnecting) {
    return <StatusScreen message="Reconnecting..." />;
  }
  if (!lobbyState) {
    return <StatusScreen message="Connecting to server..." />;
  }

  if (lobbyState.status === "empty") {
    return <StatusScreen message="The host needs to create and start a draft before players can join." />;
  }

  // Every screen past this one belongs to a seated player; anyone else
  // (new device, cleared storage, or evicted) picks a seat first.
  const iAmSeated = myPlayerId !== null && lobbyState.players.some((p) => p.id === myPlayerId);
  if (!iAmSeated) {
    return <RejoinScreen lobbyState={lobbyState} onIdentitySelected={setMyPlayerId} />;
  }

  if (lobbyState.status === "lobby") {
    return <WaitingRoom lobbyState={lobbyState} myPlayerId={myPlayerId} />;
  }
  if (lobbyState.status === "drafting") {
    return <DraftBoard lobbyState={lobbyState} myPlayerId={myPlayerId} myPack={myPack} myPool={myPool} />;
  }
  // status === "complete"
  return <ResultsScreen lobbyState={lobbyState} myPlayerId={myPlayerId} myPool={myPool} />;
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

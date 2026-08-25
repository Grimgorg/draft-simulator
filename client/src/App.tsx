import "./App.css";
import { CardPreviewProvider } from "./CardPreviewContext.js";
import { CardPreviewOverlay } from "./components/CardPreviewOverlay.js";
import { DraftBoard } from "./components/DraftBoard.js";
import { HostSetupScreen } from "./components/HostSetupScreen.js";
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
    myDeckExport,
  } = useDraftConnection();

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
    return <HostSetupScreen onCreated={setMyPlayerId} />;
  }

  const iAmSeated = myPlayerId !== null && lobbyState.players.some((p) => p.id === myPlayerId);

  if (lobbyState.status === "lobby") {
    if (!iAmSeated) {
      return <RejoinScreen lobbyState={lobbyState} onIdentitySelected={setMyPlayerId} />;
    }
    return <WaitingRoom lobbyState={lobbyState} myPlayerId={myPlayerId!} />;
  }

  if (lobbyState.status === "drafting") {
    if (!iAmSeated) {
      return <RejoinScreen lobbyState={lobbyState} onIdentitySelected={setMyPlayerId} />;
    }
    return <DraftBoard lobbyState={lobbyState} myPlayerId={myPlayerId!} myPack={myPack} myPool={myPool} />;
  }

  // status === "complete"
  if (!iAmSeated) {
    return <RejoinScreen lobbyState={lobbyState} onIdentitySelected={setMyPlayerId} />;
  }
  return (
    <ResultsScreen
      lobbyState={lobbyState}
      myPlayerId={myPlayerId!}
      myDeckExport={myDeckExport}
      onNewDraftCreated={setMyPlayerId}
    />
  );
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

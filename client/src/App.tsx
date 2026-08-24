import "./App.css";
import { DraftBoard } from "./components/DraftBoard.js";
import { HostSetupScreen } from "./components/HostSetupScreen.js";
import { JoinScreen } from "./components/JoinScreen.js";
import { ResultsScreen } from "./components/ResultsScreen.js";
import { WaitingRoom } from "./components/WaitingRoom.js";
import { useDraftConnection } from "./useDraftConnection.js";

function StatusScreen({ message }: { message: string }) {
  return (
    <div className="screen">
      <h1>Draft Simulator</h1>
      <p className="subtitle">{message}</p>
    </div>
  );
}

function App() {
  const { connected, lobbyState, myPlayerId, setMyPlayerId, myPack, myDeckExport } = useDraftConnection();

  if (!connected || !lobbyState) {
    return <StatusScreen message="Connecting to server..." />;
  }

  if (lobbyState.status === "empty") {
    return <HostSetupScreen onCreated={setMyPlayerId} />;
  }

  const iAmSeated = myPlayerId !== null && lobbyState.players.some((p) => p.id === myPlayerId);

  if (lobbyState.status === "lobby") {
    if (!iAmSeated) {
      return <JoinScreen lobbyState={lobbyState} onJoined={setMyPlayerId} />;
    }
    return <WaitingRoom lobbyState={lobbyState} myPlayerId={myPlayerId!} />;
  }

  if (lobbyState.status === "drafting") {
    if (!iAmSeated) {
      return (
        <StatusScreen message="A draft is already in progress and reconnecting mid-draft isn't supported yet — check with your host." />
      );
    }
    return <DraftBoard lobbyState={lobbyState} myPlayerId={myPlayerId!} myPack={myPack} />;
  }

  // status === "complete"
  if (!iAmSeated) {
    return <StatusScreen message="This draft has already finished." />;
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

export default App;

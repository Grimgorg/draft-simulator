import { useCallback, useEffect, useState } from "react";
import type { Card, DeckExport, LobbyStateView, Pack } from "@draft-simulator/shared";
import { socket } from "./socket.js";
import { clearStoredPlayerId, getStoredPlayerId, storePlayerId } from "./playerIdentity.js";

export interface DraftConnection {
  connected: boolean;
  /** True while a stored identity is being re-validated against the server after connect. */
  reconnecting: boolean;
  lobbyState: LobbyStateView | null;
  myPlayerId: string | null;
  /** Confirms an identity after create/join, and remembers it for reconnect-on-refresh. */
  setMyPlayerId: (id: string) => void;
  /** My own current pack, or null between rounds / before the draft starts. */
  myPack: Pack | null;
  /** My picked pool so far, driven by the server — survives refreshes and reconnects. */
  myPool: Card[];
  /** Set once, when the draft completes while I'm connected (or on reconnect after completion). */
  myDeckExport: DeckExport | null;
}

export function useDraftConnection(): DraftConnection {
  const [connected, setConnected] = useState(socket.connected);
  const [reconnecting, setReconnecting] = useState(() => getStoredPlayerId() !== null);
  const [lobbyState, setLobbyState] = useState<LobbyStateView | null>(null);
  const [myPlayerId, setMyPlayerIdState] = useState<string | null>(null);
  const [myPack, setMyPack] = useState<Pack | null>(null);
  const [myPool, setMyPool] = useState<Card[]>([]);
  const [myDeckExport, setMyDeckExport] = useState<DeckExport | null>(null);

  const setMyPlayerId = useCallback((id: string) => {
    storePlayerId(id);
    setMyPlayerIdState(id);
  }, []);

  useEffect(() => {
    function attemptReconnect() {
      const storedId = getStoredPlayerId();
      if (!storedId) {
        setReconnecting(false);
        return;
      }
      setReconnecting(true);
      socket.emit("lobby:reconnect", { playerId: storedId }, (result) => {
        setReconnecting(false);
        if (result.ok) {
          setMyPlayerIdState(storedId);
        } else {
          clearStoredPlayerId();
        }
      });
    }

    function onConnect() {
      setConnected(true);
      attemptReconnect();
    }
    function onDisconnect() {
      setConnected(false);
    }
    function onLobbyState(state: LobbyStateView) {
      setLobbyState(state);
    }
    function onMyState(state: { pack: Pack | null; pool: Card[] }) {
      setMyPack(state.pack);
      setMyPool(state.pool);
    }
    function onComplete(deckExport: DeckExport) {
      setMyDeckExport(deckExport);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("lobby:state", onLobbyState);
    socket.on("draft:myState", onMyState);
    socket.on("draft:complete", onComplete);

    // The socket may already be connected by the time this effect runs
    // (it connects at module load), in which case "connect" won't fire again.
    if (socket.connected) attemptReconnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("lobby:state", onLobbyState);
      socket.off("draft:myState", onMyState);
      socket.off("draft:complete", onComplete);
    };
  }, []);

  return { connected, reconnecting, lobbyState, myPlayerId, setMyPlayerId, myPack, myPool, myDeckExport };
}

import { useEffect, useState } from "react";
import type { DeckExport, LobbyStateView, Pack } from "@draft-simulator/shared";
import { socket } from "./socket.js";

export interface DraftConnection {
  connected: boolean;
  lobbyState: LobbyStateView | null;
  myPlayerId: string | null;
  setMyPlayerId: (id: string) => void;
  /** My own current pack, or null between rounds / before the draft starts. */
  myPack: Pack | null;
  /** Set once, when the draft completes while I'm connected. */
  myDeckExport: DeckExport | null;
}

export function useDraftConnection(): DraftConnection {
  const [connected, setConnected] = useState(socket.connected);
  const [lobbyState, setLobbyState] = useState<LobbyStateView | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [myPack, setMyPack] = useState<Pack | null>(null);
  const [myDeckExport, setMyDeckExport] = useState<DeckExport | null>(null);

  useEffect(() => {
    function onConnect() {
      setConnected(true);
    }
    function onDisconnect() {
      setConnected(false);
    }
    function onLobbyState(state: LobbyStateView) {
      setLobbyState(state);
    }
    function onPackUpdate(pack: Pack) {
      setMyPack(pack);
    }
    function onComplete(deckExport: DeckExport) {
      setMyDeckExport(deckExport);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("lobby:state", onLobbyState);
    socket.on("draft:packUpdate", onPackUpdate);
    socket.on("draft:complete", onComplete);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("lobby:state", onLobbyState);
      socket.off("draft:packUpdate", onPackUpdate);
      socket.off("draft:complete", onComplete);
    };
  }, []);

  return { connected, lobbyState, myPlayerId, setMyPlayerId, myPack, myDeckExport };
}

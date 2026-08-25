import { useCallback, useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import type { Card, DeckExport, HubStateView, LobbyStateView, MatchStateView, Pack } from "@draft-simulator/shared";
import { socket } from "./socket.js";
import { clearStoredPlayerId, getStoredPlayerId, storePlayerId } from "./playerIdentity.js";
import { getStoredPassword, storePassword } from "./lobbyPassword.js";

export interface DraftConnection {
  connected: boolean;
  /** True while a stored identity is being re-validated against the server after connect. */
  reconnecting: boolean;
  /** True after another device/tab just claimed this identity via lobby:reconnect. */
  evicted: boolean;
  /** Clears the eviction notice once the user has acknowledged it. */
  dismissEviction: () => void;
  lobbyState: LobbyStateView | null;
  /** Post-draft hub: who's ready to play and who's mid-match. Empty player list until the draft is complete. */
  hubState: HubStateView | null;
  /** An incoming challenge nobody has responded to yet, or null. */
  incomingChallenge: { fromId: string; fromName: string } | null;
  /** My current match, or null when I'm not in one. */
  matchState: MatchStateView | null;
  myPlayerId: string | null;
  /** Confirms an identity after create/join, and remembers it for reconnect-on-refresh. */
  setMyPlayerId: (id: string) => void;
  /** My own current pack, or null between rounds / before the draft starts. */
  myPack: Pack | null;
  /** My picked pool so far, driven by the server — survives refreshes and reconnects. */
  myPool: Card[];
  /** Set once, when the draft completes while I'm connected (or on reconnect after completion). */
  myDeckExport: DeckExport | null;
  /** True when the server requires a lobby password we haven't supplied (or supplied wrong). */
  passwordRequired: boolean;
  passwordError: string | null;
  /** Stores the password, retries the connection with it, and clears any prior error. */
  submitPassword: (password: string) => void;
}

export function useDraftConnection(): DraftConnection {
  const [connected, setConnected] = useState(socket.connected);
  const [reconnecting, setReconnecting] = useState(() => getStoredPlayerId() !== null);
  const [evicted, setEvicted] = useState(false);
  const [lobbyState, setLobbyState] = useState<LobbyStateView | null>(null);
  const [hubState, setHubState] = useState<HubStateView | null>(null);
  const [incomingChallenge, setIncomingChallenge] = useState<{ fromId: string; fromName: string } | null>(null);
  const [matchState, setMatchState] = useState<MatchStateView | null>(null);
  const [myPlayerId, setMyPlayerIdState] = useState<string | null>(null);
  const [myPack, setMyPack] = useState<Pack | null>(null);
  const [myPool, setMyPool] = useState<Card[]>([]);
  const [myDeckExport, setMyDeckExport] = useState<DeckExport | null>(null);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const setMyPlayerId = useCallback((id: string) => {
    storePlayerId(id);
    setMyPlayerIdState(id);
  }, []);

  const dismissEviction = useCallback(() => setEvicted(false), []);

  const submitPassword = useCallback((password: string) => {
    storePassword(password);
    setPasswordError(null);
    socket.auth = { password };
    socket.connect();
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
      setPasswordRequired(false);
      setPasswordError(null);
      attemptReconnect();
    }
    function onDisconnect(reason: Socket.DisconnectReason) {
      setConnected(false);
      // A server-forced disconnect (e.g. this identity got claimed elsewhere)
      // is the one disconnect reason socket.io-client won't auto-reconnect
      // from on its own — every other reason already retries by itself.
      if (reason === "io server disconnect") {
        socket.connect();
      }
    }
    function onConnectError(err: Error) {
      if (err.message !== "invalid_password") return;
      setPasswordRequired(true);
      // A first-time visitor never sent a password at all — only show an
      // "incorrect" error when one was actually tried and rejected.
      setPasswordError(getStoredPassword() ? "Incorrect password." : null);
      // Without this, socket.io's default reconnection logic would keep
      // retrying with the same known-bad credentials in a loop.
      socket.disconnect();
    }
    function onLobbyState(state: LobbyStateView) {
      setLobbyState(state);
    }
    function onHubState(state: HubStateView) {
      setHubState(state);
    }
    function onChallengeReceived(payload: { fromId: string; fromName: string }) {
      setIncomingChallenge(payload);
    }
    function onMatchState(state: MatchStateView) {
      setIncomingChallenge(null);
      setMatchState(state);
    }
    function onMatchEnded() {
      setMatchState(null);
    }
    function onMyState(state: { pack: Pack | null; pool: Card[] }) {
      setMyPack(state.pack);
      setMyPool(state.pool);
    }
    function onComplete(deckExport: DeckExport) {
      setMyDeckExport(deckExport);
    }
    function onEvicted() {
      clearStoredPlayerId();
      setMyPlayerIdState(null);
      setMyPack(null);
      setMyPool([]);
      setMyDeckExport(null);
      setIncomingChallenge(null);
      setMatchState(null);
      setEvicted(true);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("lobby:state", onLobbyState);
    socket.on("hub:state", onHubState);
    socket.on("hub:challengeReceived", onChallengeReceived);
    socket.on("match:state", onMatchState);
    socket.on("match:ended", onMatchEnded);
    socket.on("draft:myState", onMyState);
    socket.on("draft:complete", onComplete);
    socket.on("identity:evicted", onEvicted);

    // The socket may already be connected by the time this effect runs
    // (it connects at module load), in which case "connect" won't fire again.
    if (socket.connected) attemptReconnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("lobby:state", onLobbyState);
      socket.off("hub:state", onHubState);
      socket.off("hub:challengeReceived", onChallengeReceived);
      socket.off("match:state", onMatchState);
      socket.off("match:ended", onMatchEnded);
      socket.off("draft:myState", onMyState);
      socket.off("draft:complete", onComplete);
      socket.off("identity:evicted", onEvicted);
    };
  }, []);

  return {
    connected,
    reconnecting,
    evicted,
    dismissEviction,
    lobbyState,
    hubState,
    incomingChallenge,
    matchState,
    myPlayerId,
    setMyPlayerId,
    myPack,
    myPool,
    myDeckExport,
    passwordRequired,
    passwordError,
    submitPassword,
  };
}

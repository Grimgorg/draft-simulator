import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type { Card, DeckExport, DraftSummary, LobbyStateView, Pack } from "@draft-simulator/shared";
import { socket } from "./socket.js";
import { clearStoredSeat, getStoredSeat, storeSeat, type StoredSeat } from "./playerIdentity.js";
import { getStoredPassword, storePassword } from "./lobbyPassword.js";

export interface DraftConnection {
  connected: boolean;
  /** True while a stored seat is being re-validated against the server after connect. */
  reconnecting: boolean;
  /** True after another device/tab just claimed this identity via lobby:reconnect. */
  evicted: boolean;
  /** Clears the eviction notice once the user has acknowledged it. */
  dismissEviction: () => void;
  /** True after the draft this browser was seated in was closed by its creator or the host. */
  draftClosed: boolean;
  dismissDraftClosed: () => void;
  /** Every draft on the server, newest first; null until the server first sends them. */
  drafts: DraftSummary[] | null;
  /** The draft this browser is seated in, as which player. */
  seat: StoredSeat | null;
  /** Confirms a seat after create/join/rejoin, and remembers it for reconnect-on-refresh. */
  takeSeat: (seat: StoredSeat) => void;
  /** Forgets the seat, after the server let it go (lobby:leave) or the draft was closed. */
  leaveSeat: () => void;
  /** The state of the draft this browser is seated in. */
  lobbyState: LobbyStateView | null;
  /** My own current pack, or null between rounds / before the draft starts. */
  myPack: Pack | null;
  /** In a Winston draft, the pile I'm looking at: null unless it's my turn. */
  myPile: Card[] | null;
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
  const [reconnecting, setReconnecting] = useState(() => getStoredSeat() !== null);
  const [evicted, setEvicted] = useState(false);
  const [draftClosed, setDraftClosed] = useState(false);
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [seat, setSeat] = useState<StoredSeat | null>(null);
  const [lobbyState, setLobbyState] = useState<LobbyStateView | null>(null);
  const [myPack, setMyPack] = useState<Pack | null>(null);
  const [myPile, setMyPile] = useState<Card[] | null>(null);
  const [myPool, setMyPool] = useState<Card[]>([]);
  const [myDeckExport, setMyDeckExport] = useState<DeckExport | null>(null);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  /**
   * The seat the socket listeners compare against. A draft's events can still arrive just after leaving it, and
   * the state of the seat they'd set is a render behind.
   */
  const seatRef = useRef<StoredSeat | null>(null);

  const applySeat = useCallback((next: StoredSeat | null) => {
    // Reconnecting after a network blip keeps the seat: the screen stays as it was until the server's update.
    const current = seatRef.current;
    if (current && next && current.draftId === next.draftId && current.playerId === next.playerId) return;
    seatRef.current = next;
    setSeat(next);
    setLobbyState(null);
    setMyPack(null);
    setMyPile(null);
    setMyPool([]);
    setMyDeckExport(null);
  }, []);

  const takeSeat = useCallback(
    (next: StoredSeat) => {
      storeSeat(next);
      applySeat(next);
    },
    [applySeat]
  );

  const leaveSeat = useCallback(() => {
    clearStoredSeat();
    applySeat(null);
  }, [applySeat]);

  const dismissEviction = useCallback(() => setEvicted(false), []);
  const dismissDraftClosed = useCallback(() => setDraftClosed(false), []);

  const submitPassword = useCallback((password: string) => {
    storePassword(password);
    setPasswordError(null);
    socket.auth = { password };
    socket.connect();
  }, []);

  useEffect(() => {
    function attemptReconnect() {
      const stored = getStoredSeat();
      if (!stored) {
        setReconnecting(false);
        return;
      }
      setReconnecting(true);
      socket.emit("lobby:reconnect", stored, (result) => {
        setReconnecting(false);
        if (result.ok) {
          // A seat stored before seats had tokens gets one now.
          const seat = { ...stored, seatToken: result.seatToken };
          storeSeat(seat);
          applySeat(seat);
        } else {
          clearStoredSeat();
          applySeat(null);
        }
      });
    }

    const isMine = (draftId: string) => seatRef.current?.draftId === draftId;

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
      // Without this, an evicted tab sat on "Connecting to server..." forever.
      if (reason === "io server disconnect") {
        socket.connect();
      }
    }
    function onConnectError(err: Error) {
      if (err.message !== "invalid_password" && err.message !== "too_many_attempts") return;
      setPasswordRequired(true);
      if (err.message === "too_many_attempts") {
        // The server refuses this address for a while, even with the right password.
        setPasswordError("Too many wrong passwords. Try again in a few minutes.");
      } else {
        // A first-time visitor never sent a password at all — only show an
        // "incorrect" error when one was actually tried and rejected.
        setPasswordError(getStoredPassword() ? "Incorrect password." : null);
      }
      // Without this, socket.io's default reconnection logic would keep
      // retrying with the same known-bad credentials in a loop.
      socket.disconnect();
    }
    function onDraftList(list: DraftSummary[]) {
      setDrafts(list);
    }
    function onLobbyState(state: LobbyStateView) {
      if (isMine(state.sessionId)) setLobbyState(state);
    }
    // Sent only for the socket's own seat, so no draft id to check: the seat it was sent for may not be stored yet.
    function onMyState(state: { pack: Pack | null; pool: Card[]; pile?: Card[] | null }) {
      setMyPack(state.pack);
      setMyPile(state.pile ?? null);
      setMyPool(state.pool);
    }
    function onComplete(deckExport: DeckExport) {
      setMyDeckExport(deckExport);
    }
    function onDraftClosed(draftId: string) {
      if (!isMine(draftId)) return;
      clearStoredSeat();
      applySeat(null);
      setDraftClosed(true);
    }
    function onEvicted() {
      clearStoredSeat();
      applySeat(null);
      setEvicted(true);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("drafts:list", onDraftList);
    socket.on("lobby:state", onLobbyState);
    socket.on("draft:myState", onMyState);
    socket.on("draft:complete", onComplete);
    socket.on("draft:closed", onDraftClosed);
    socket.on("identity:evicted", onEvicted);

    // The socket used to connect at module load, and on a fast connection (or
    // a slow device) it finished before this effect ran: the "connect" event
    // and the server's first lobby:state were both missed, and the page sat on
    // "Connecting to server..." for good. Now it only connects from here, once
    // every listener above is attached. It can already be open only when the
    // hook remounts on a live socket, where `connected` starts out true.
    if (socket.connected) {
      attemptReconnect();
    } else {
      socket.connect();
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("drafts:list", onDraftList);
      socket.off("lobby:state", onLobbyState);
      socket.off("draft:myState", onMyState);
      socket.off("draft:complete", onComplete);
      socket.off("draft:closed", onDraftClosed);
      socket.off("identity:evicted", onEvicted);
    };
  }, [applySeat]);

  return {
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
    myDeckExport,
    passwordRequired,
    passwordError,
    submitPassword,
  };
}

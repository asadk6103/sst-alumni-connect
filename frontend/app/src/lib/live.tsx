import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { refreshAccess, tokenStore } from './api';
import { useToast } from '@/components/ui/overlay';

/**
 * One WebSocket per tab to the real-time gateway. Pages subscribe to rooms with `useRoom`; the gateway
 * authorises every subscription. Live events only refresh data — pages always load it over REST too,
 * so a dropped connection just delays updates, and rooms are re-joined automatically after reconnecting.
 */
type Live = { socket: Socket | null; connected: boolean };
const LiveContext = createContext<Live>({ socket: null, connected: false });
export const useLive = () => useContext(LiveContext);

export function LiveProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const qc = useQueryClient();
  const toastFn = useToast();
  const toastRef = useRef(toastFn);
  toastRef.current = toastFn;
  const [state, setState] = useState<Live>({ socket: null, connected: false });

  useEffect(() => {
    if (!enabled) return;
    let retries = 0;
    let stopped = false;
    const socket: Socket = io({
      path: '/realtime/socket.io', transports: ['websocket'], autoConnect: false,
      auth: (cb) => cb({ token: tokenStore.get() }),
    });
    let ping: ReturnType<typeof setInterval> | undefined;
    let wasConnected = false;
    socket.on('connect', () => {
      retries = 0;
      setState({ socket, connected: true });
      // Anything that happened while disconnected is fetched again.
      if (wasConnected) for (const k of ['conversations', 'messages', 'conversation', 'unread', 'notifications', 'feed']) qc.invalidateQueries({ queryKey: [k] });
      wasConnected = true;
      ping = setInterval(() => socket.emit('presence:ping'), 25_000);
    });
    socket.on('disconnect', () => { clearInterval(ping); setState({ socket, connected: false }); });
    socket.on('connect_error', async (err) => {
      // Refused (expired token) or unreachable — refresh the token if needed, then retry with back-off (max 30 s), forever.
      if (stopped) return;
      retries += 1;
      if (err.message === 'unauthenticated') await refreshAccess().catch(() => null);
      setTimeout(() => { if (!stopped && !socket.connected) socket.connect(); }, Math.min(30_000, 1500 * retries));
    });
    socket.on('connection:request', (d: { name: string }) => {
      toastRef.current.success(`${d.name} sent you a connection request.`);
      qc.invalidateQueries({ queryKey: ['alumni-dashboard'] });
      qc.invalidateQueries({ queryKey: ['connections'] });
    });
    socket.on('connection:accepted', (d: { name: string }) => {
      toastRef.current.success(`${d.name} accepted your connection request.`);
      for (const k of ['alumni-dashboard', 'connections', 'directory', 'alumni-profile']) qc.invalidateQueries({ queryKey: [k] });
    });
    socket.on('message:new', () => qc.invalidateQueries({ queryKey: ['unread'] }));
    socket.on('conversation:read', () => qc.invalidateQueries({ queryKey: ['unread'] }));
    socket.on('group:decision', (d: { name: string; approved: boolean }) => {
      toastRef.current[d.approved ? 'success' : 'error'](d.approved ? `Your group “${d.name}” was approved.` : `Your group “${d.name}” was not approved.`);
      qc.invalidateQueries({ queryKey: ['groups'] });
    });
    // The server ended the connection (e.g. the session was refreshed): socket.io does not retry those by itself.
    socket.on('disconnect', (reason) => { if (reason === 'io server disconnect' && !stopped) setTimeout(() => socket.connect(), 1500); });
    setState({ socket, connected: false });
    if (tokenStore.get()) socket.connect();
    // Connect as soon as a token is available (first load, after sign-in or refresh).
    const unsubscribe = tokenStore.subscribe((t) => { if (t && !stopped && !socket.connected && !socket.active) socket.connect(); });
    const onOnline = () => { if (!stopped && !socket.connected) socket.connect(); };
    window.addEventListener('online', onOnline);
    return () => { stopped = true; unsubscribe(); window.removeEventListener('online', onOnline); clearInterval(ping); socket.disconnect(); setState({ socket: null, connected: false }); };
  }, [enabled, qc]);

  return <LiveContext.Provider value={state}>{children}</LiveContext.Provider>;
}

/** Join a room while mounted (re-joined after reconnects) and listen to events on the shared socket. */
export function useRoom(room: string | null, handlers: Record<string, (data: never) => void>) {
  const { socket, connected } = useLive();
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!socket || !connected || !room) return;
    socket.emit('subscribe', { room });
    return () => { socket.emit('unsubscribe', { room }); };
  }, [socket, connected, room]);
  const names = Object.keys(handlers).join(',');
  useEffect(() => {
    if (!socket) return;
    const offs = names.split(',').filter(Boolean).map((name) => {
      const fn = (d: unknown) => ref.current[name]?.(d as never);
      socket.on(name, fn);
      return () => socket.off(name, fn);
    });
    return () => offs.forEach((o) => o());
  }, [socket, names]);
}

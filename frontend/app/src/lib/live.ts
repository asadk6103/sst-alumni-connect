import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { refreshAccess, tokenStore } from './api';
import { useToast } from '@/components/ui/overlay';

/**
 * Live updates from the real-time gateway (WebSocket only). Pages still load their own data, so
 * a missed event only delays an update; events just refresh the affected queries.
 */
export function useLiveEvents(enabled: boolean) {
  const qc = useQueryClient();
  const toastFn = useToast();
  const toastRef = useRef(toastFn);
  toastRef.current = toastFn;
  useEffect(() => {
    if (!enabled) return;
    let retries = 0;
    let stopped = false;
    const socket: Socket = io({
      path: '/realtime/socket.io', transports: ['websocket'], autoConnect: false,
      auth: (cb) => cb({ token: tokenStore.get() }),
    });
    socket.on('connect', () => { retries = 0; });
    socket.on('connect_error', async (err) => {
      // Refused by the gateway (expired token) — refresh once, then retry with back-off.
      if (stopped || retries >= 5) return;
      retries += 1;
      if (err.message === 'unauthenticated') await refreshAccess().catch(() => null);
      setTimeout(() => { if (!stopped && !socket.connected) socket.connect(); }, 1500 * retries);
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
    if (tokenStore.get()) socket.connect();
    return () => { stopped = true; socket.disconnect(); };
  }, [enabled, qc]);
}

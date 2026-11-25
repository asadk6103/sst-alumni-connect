import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshAccess, tokenStore } from './api';

export type User = {
  id: string; email: string; full_name: string; phone: string | null; status: string; language: string | null;
  email_verified: boolean; phone_verified: boolean; roles: { key: string; name: string }[]; permissions: string[];
  is_staff: boolean; mfa_enabled: boolean; mfa_setup_required: boolean; password_expired: boolean;
};

type LoginResult = { mfa_required: true; challenge: string } | { mfa_required?: false; user: User };

type AuthState = {
  user: User | null;
  ready: boolean;
  can: (perm: string) => boolean;
  login: (email: string, password: string, remember?: boolean) => Promise<LoginResult>;
  completeMfa: (challenge: string, code: string) => Promise<User>;
  acceptSession: (access: string, user: User) => void;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const a = useContext(AuthContext);
  if (!a) throw new Error('useAuth outside AuthProvider');
  return a;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();

  const reload = useCallback(async () => {
    try {
      const r = await api<{ data: User }>('/api/v1/auth/me');
      setUser(r.data);
    } catch {
      setUser(null);
    }
  }, []);

  // Restore the session from the refresh cookie on first load.
  useEffect(() => {
    (async () => {
      const t = await refreshAccess().catch(() => null);
      if (t) await reload();
      setReady(true);
    })();
  }, [reload]);

  // Another tab signed out → follow.
  useEffect(() => {
    const ch = 'BroadcastChannel' in window ? new BroadcastChannel('sst-auth') : null;
    if (ch) ch.onmessage = (e) => {
      if (e.data === 'logout') {
        tokenStore.set(null);
        setUser(null);
        qc.clear();
      }
    };
    return () => ch?.close();
  }, [qc]);

  const acceptSession = useCallback((access: string, u: User) => {
    tokenStore.set(access);
    setUser(u);
  }, []);

  const login = useCallback(async (email: string, password: string, remember = true): Promise<LoginResult> => {
    const r = await api<{ data: { mfa_required?: boolean; challenge?: string; access_token?: string; user?: User } }>(
      '/api/v1/auth/login', { method: 'POST', body: { email, password, remember }, auth: false });
    if (r.data.mfa_required) return { mfa_required: true, challenge: r.data.challenge! };
    acceptSession(r.data.access_token!, r.data.user!);
    return { user: r.data.user! };
  }, [acceptSession]);

  const completeMfa = useCallback(async (challenge: string, code: string) => {
    const r = await api<{ data: { access_token: string; user: User } }>('/api/v1/auth/login/mfa', {
      method: 'POST', body: { challenge, code }, auth: false });
    acceptSession(r.data.access_token, r.data.user);
    return r.data.user;
  }, [acceptSession]);

  const logout = useCallback(async () => {
    await api('/api/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    tokenStore.set(null);
    setUser(null);
    qc.clear();
    if ('BroadcastChannel' in window) {
      const ch = new BroadcastChannel('sst-auth');
      ch.postMessage('logout');
      ch.close();
    }
  }, [qc]);

  const value = useMemo<AuthState>(() => ({
    user, ready, login, completeMfa, acceptSession, logout, reload,
    can: (perm) => !!user && (user.roles.some((r) => r.key === 'super_admin') || user.permissions.includes(perm)),
  }), [user, ready, login, completeMfa, acceptSession, logout, reload]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Where a user lands after signing in. */
export function homeFor(u: User) {
  if (u.mfa_setup_required || u.password_expired) return '/portal/account/security';
  return '/portal'; // everyone starts on the Feed; staff open Administration from the menu
}

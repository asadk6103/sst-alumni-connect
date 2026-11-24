/**
 * API client. The access token lives in memory only; the refresh token is an httpOnly cookie.
 * Refreshing is single-flight per tab and serialised across tabs with the Web Locks API, so several
 * open tabs never replay the same refresh token.
 */

export type ApiErrorBody = { code: string; message: string; details?: { field: string; message: string }[] | Record<string, unknown> };

export class ApiError extends Error {
  status: number;
  code: string;
  details?: ApiErrorBody['details'];
  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
  /** Field errors as a {field: message} map (for forms). */
  get fields(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) for (const d of this.details) out[d.field] = d.message;
    return out;
  }
}

let accessToken: string | null = null;
let refreshing: Promise<string | null> | null = null;
const listeners = new Set<(t: string | null) => void>();

export const tokenStore = {
  get: () => accessToken,
  set(t: string | null) {
    accessToken = t;
    listeners.forEach((l) => l(t));
  },
  subscribe(l: (t: string | null) => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

async function doRefresh(): Promise<string | null> {
  const run = async () => {
    const r = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'same-origin' });
    if (!r.ok) return null;
    const body = await r.json();
    return (body.data?.access_token as string | undefined) ?? null;
  };
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  const token = locks ? await locks.request('sst-auth-refresh', run) : await run();
  tokenStore.set(token);
  return token;
}

export function refreshAccess(): Promise<string | null> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

type Options = Omit<RequestInit, 'body'> & { body?: unknown; raw?: boolean; auth?: boolean };

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const { body, raw, auth = true, ...init } = opts;
  const headers = new Headers(init.headers);
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers.set('content-type', 'application/json');
  const send = (token: string | null) => {
    if (auth && token) headers.set('authorization', `Bearer ${token}`);
    return fetch(path, {
      ...init,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  };
  let res = await send(accessToken);
  if (res.status === 401 && auth && !path.startsWith('/api/v1/auth/login')) {
    const t = await refreshAccess();
    if (t) res = await send(t);
  }
  if (raw) {
    if (!res.ok) throw new ApiError(res.status, { code: 'HTTP_ERROR', message: `Request failed (${res.status})` });
    return res as unknown as T;
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(res.status, json.error ?? { code: 'HTTP_ERROR', message: `Request failed (${res.status})` });
  }
  return json as T;
}

/** Convenience: returns `data` of the standard envelope. */
export async function get<T>(path: string): Promise<T> {
  return (await api<{ data: T }>(path)).data;
}

export type Paged<T> = { data: T[]; meta: { page: number; page_size: number; total: number; pages: number } };

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function download(path: string, filename: string) {
  const res = await api<Response>(path, { raw: true });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { setFormatPrefs } from '@/lib/utils';

/** Member settings (Settings pages); mirrors backend services/member_settings.DEFAULTS. */
export type Prefs = {
  show_in_directory: boolean; appear_in_search: boolean; show_communities: boolean; show_online: boolean; show_last_active: boolean;
  show_activity: boolean; show_connections: boolean; show_mutual: boolean; suggest_me: boolean;
  connection_requests: 'anyone' | 'batch' | 'batch_range' | 'none'; msg_batchmates: boolean; msg_alumni: boolean; msg_community: boolean; allow_follow: boolean;
  feed_sources: string[]; feed_types: string[]; feed_order: 'relevant' | 'latest'; hide_not_interested: boolean; autoplay: boolean; read_receipts: boolean;
  typing: boolean; theme: 'light' | 'dark' | 'system'; font_size: 'small' | 'medium' | 'large'; compact: boolean; open_links_new_tab: boolean;
  show_suggestions: boolean; weekly_digest: boolean; timezone: string; date_format: string; time_format: '12' | '24'; first_day: string; calendar: string;
  region_country: string | null; region_city: string | null; regional_content: boolean; local_time_in_emails: boolean;
  consent_analytics: boolean; consent_personalization: boolean; consent_product_updates: boolean; consent_announcements: boolean; data_retention: string;
  login_alerts: boolean; group_invites: "connections" | "none";
};

export const DEFAULT_PREFS: Partial<Prefs> = { theme: 'light', font_size: 'medium', compact: false, autoplay: true, typing: true, open_links_new_tab: true,
  show_suggestions: true, feed_order: 'relevant', date_format: 'DD MMM, YYYY', time_format: '12', timezone: 'Asia/Karachi' };

export function useMemberSettings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['member-settings'], queryFn: () => get<Prefs>('/api/v1/me/settings'), enabled: !!user, staleTime: 5 * 60_000 });
  const save = useMutation({
    mutationFn: (changes: Partial<Prefs>) => api<{ data: Prefs }>('/api/v1/me/settings', { method: 'PUT', body: changes }),
    onMutate: (changes) => {
      const prev = qc.getQueryData<Prefs>(['member-settings']);
      if (prev) qc.setQueryData(['member-settings'], { ...prev, ...changes });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['member-settings'], ctx.prev); },
    onSuccess: (r) => qc.setQueryData(['member-settings'], r.data),
  });
  return { prefs: q.data, loading: q.isLoading, save };
}

/** Read one preference with a fallback (for components outside the settings pages). */
export function usePref<K extends keyof Prefs>(key: K): Prefs[K] {
  const { prefs } = useMemberSettings();
  return (prefs?.[key] ?? DEFAULT_PREFS[key]) as Prefs[K];
}

const DARK: Record<string, string> = {
  '--surface': '24 29 41', '--canvas': '15 19 28', '--ink': '230 234 242', '--ink-muted': '150 162 184', '--line': '48 56 72', '--primary-light': '45 36 80',
};
const saved: Record<string, string> = {};

function applyAppearance(p: Partial<Prefs>) {
  const el = document.documentElement;
  const dark = p.theme === 'dark' || (p.theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  el.dataset.theme = dark ? 'dark' : 'light';
  for (const [k, v] of Object.entries(DARK)) {
    if (dark) {
      if (!(k in saved)) saved[k] = el.style.getPropertyValue(k);
      el.style.setProperty(k, v);
    } else if (k in saved) {
      if (saved[k]) el.style.setProperty(k, saved[k]); else el.style.removeProperty(k);
      delete saved[k];
    }
  }
  el.style.fontSize = p.font_size === 'small' ? '14.5px' : p.font_size === 'large' ? '17.5px' : '';
  el.dataset.density = p.compact ? 'compact' : 'comfortable';
}

/** Applies the signed-in member's appearance and date/time preferences (mounted once in the portal shell). */
export function useApplyPrefs() {
  const { prefs } = useMemberSettings();
  // formats are read while rendering, so set them before children render (not in an effect)
  const f = prefs ?? DEFAULT_PREFS;
  setFormatPrefs({ date: f.date_format ?? 'DD MMM, YYYY', time: f.time_format ?? '12', tz: f.timezone ?? undefined });
  useEffect(() => {
    const p = prefs ?? DEFAULT_PREFS;
    applyAppearance(p);
    if (p.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyAppearance(p);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [prefs]);
  useEffect(() => () => applyAppearance({ theme: 'light', font_size: 'medium', compact: false }), []);
}

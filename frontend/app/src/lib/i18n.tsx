import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { Languages } from 'lucide-react';
import { api } from './api';
import { useAuth } from './auth';
import { useSite } from './site';

type Bundle = { code: string; rtl: boolean; name: string; messages: Record<string, string> };
export type Language = { code: string; name: string; native_name: string; rtl: boolean };
type I18n = {
  lang: string; rtl: boolean; languages: Language[];
  /** Translate a key; the English text is the fallback while loading or when the key is unknown. */
  t: (key: string, fallback: string) => string;
  setLanguage: (code: string) => Promise<void>;
};

const STORAGE = 'sst-lang';
const Ctx = createContext<I18n | null>(null);

function stored(): string | null {
  try { return localStorage.getItem(STORAGE); } catch { return null; }
}

/** Interface language: the member's saved choice, else this browser's choice, else the institution default. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const site = useSite();
  const { user, reload } = useAuth();
  const [local, setLocal] = useState<string | null>(stored);
  const languages = useQuery({ queryKey: ['languages'], staleTime: 300_000,
    queryFn: () => api<{ data: Language[] }>('/api/v1/public/languages', { auth: false }).then((r) => r.data) });
  // The administration console stays in English; translations cover the member-facing interface and website.
  const adminArea = useLocation().pathname.startsWith('/admin');
  const wanted = user?.language || local || site.default_language || 'en';
  const enabled = languages.data?.some((l) => l.code === wanted) ?? true;
  const lang = enabled && !adminArea ? wanted : 'en';
  const bundle = useQuery({ queryKey: ['i18n', lang], enabled: lang !== 'en', staleTime: 300_000,
    queryFn: () => api<{ data: Bundle }>(`/api/v1/public/i18n/${lang}`, { auth: false }).then((r) => r.data) });
  const rtl = lang === 'en' ? false : bundle.data?.rtl ?? languages.data?.find((l) => l.code === lang)?.rtl ?? false;

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
  }, [lang, rtl]);

  const messages = bundle.data?.messages;
  const t = useCallback((key: string, fallback: string) => (lang !== 'en' && messages?.[key]) || fallback, [lang, messages]);
  const setLanguage = useCallback(async (code: string) => {
    try { localStorage.setItem(STORAGE, code); } catch { /* private mode */ }
    setLocal(code);
    if (user) {
      await api('/api/v1/auth/me', { method: 'PATCH', body: { language: code } }).catch(() => undefined);
      await reload();
    }
  }, [user, reload]);

  const value = useMemo(() => ({ lang, rtl, t, setLanguage, languages: languages.data ?? [] }), [lang, rtl, t, setLanguage, languages.data]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}

export function useT() {
  return useI18n().t;
}

/** Compact language picker (only shown when more than one language is enabled). */
export function LanguageSwitcher({ light, className = '' }: { light?: boolean; className?: string }) {
  const { lang, languages, setLanguage, t } = useI18n();
  if (languages.length < 2) return null;
  return (
    <label className={`relative inline-flex items-center gap-1.5 text-sm ${light ? 'text-white/85' : 'text-ink-muted'} ${className}`}>
      <Languages className="h-4 w-4 shrink-0" aria-hidden />
      <span className="sr-only">{t('common.language', 'Language')}</span>
      <select value={lang} onChange={(e) => setLanguage(e.target.value)}
        className={`cursor-pointer appearance-none rounded-btn bg-transparent py-1 pe-1 font-medium focus:outline-none focus-visible:ring-2 ${light ? 'focus-visible:ring-white/50 [&>option]:text-ink' : 'focus-visible:ring-primary/40'}`}>
        {languages.map((l) => <option key={l.code} value={l.code}>{l.native_name}</option>)}
      </select>
    </label>
  );
}

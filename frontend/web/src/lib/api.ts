import { cookies } from 'next/headers';

// Server-side access to the public API (inside Docker: http://api:8000).
const API = process.env.API_INTERNAL_URL ?? 'http://localhost:8100';

export type Img = { id: string; url: string; alt?: string; variants?: { width: number; url: string }[] } | null;
export type NavLink = { label: string; href: string; new_tab: boolean; i18n: string | null; children: NavLink[] };
export type Website = {
  header: NavLink[]; footer: NavLink[]; footer_text: string; social: Record<string, string>;
  contact: { email: string | null; phone: string | null; address: string | null }; contact_form: boolean; show_events: boolean; newsletter: boolean; home_page: string | null;
};
export type Block = { id: string; type: string; heading: string; [k: string]: unknown };
export type CmsPage = { id: string; slug: string; title: string; seo_title: string; seo_description: string; featured_image: Img; published_at: string | null; blocks: Block[] };
export type NewsCard = { id: string; slug: string; title: string; category: string; summary: string; cover: Img; published_at: string; pinned: boolean };
export type Article = NewsCard & { html: string; seo_title: string; seo_description: string; related: NewsCard[] };
export type EventCard = { id: string; title: string; kind: string; summary: string; starts_at: string; ends_at: string; venue: string | null; address: string | null; is_online: boolean; banner: Img; full: boolean };
export type Album = { id: string; title: string; description: string; cover: Img; taken_on: string | null; photo_count: number; photos?: (NonNullable<Img> & { caption: string | null })[] };
export type Achievement = { id: string; kind: string; kind_label: string; title: string; summary: string; story: string; image: Img; year: number | null;
  person: { full_name: string; photo: Img; batch: string | null } | null };

/** GET a public API path; returns null on 404 / errors so pages can show "not found" instead of crashing. */
export async function apiGet<T>(path: string, revalidate = 15): Promise<T | null> {
  try {
    const r = await fetch(`${API}${path}`, revalidate ? { next: { revalidate } } : { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()).data as T;
  } catch {
    return null;
  }
}

export async function apiPaged<T>(path: string): Promise<{ data: T[]; meta: { page: number; pages: number; total: number } } | null> {
  try {
    const r = await fetch(`${API}${path}`, { next: { revalidate: 15 } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export const LANG_COOKIE = 'sst-lang';

export async function currentLang(fallback = 'en'): Promise<string> {
  const c = (await cookies()).get(LANG_COOKIE)?.value;
  return c && /^[a-z]{2}(-[A-Z]{2})?$/.test(c) ? c : fallback;
}

type Bundle = { code: string; rtl: boolean; messages: Record<string, string> };
export type T = (key: string, fallback: string) => string;

export async function i18n(lang: string): Promise<{ t: T; rtl: boolean; lang: string }> {
  if (lang === 'en') return { t: (_k, f) => f, rtl: false, lang };
  const b = await apiGet<Bundle>(`/api/v1/public/i18n/${lang}`, 60);
  if (!b) return { t: (_k, f) => f, rtl: false, lang: 'en' };
  return { t: (k, f) => b.messages[k] || f, rtl: b.rtl, lang };
}

export const imgSrc = (m: Img | undefined, w: number) => (m ? m.variants?.find((v) => v.width >= w)?.url ?? m.url : undefined);

export function fmtDate(iso: string, lang = 'en', opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  try {
    return new Intl.DateTimeFormat(lang === 'ur' ? 'ur-PK' : 'en-GB', { timeZone: 'Asia/Karachi', ...opts }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

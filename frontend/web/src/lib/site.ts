// Server-side access to the public API (inside Docker: http://api:8000).
const API = process.env.API_INTERNAL_URL ?? 'http://localhost:8100';

export type MediaItem = { id: string; url: string; alt: string; width: number | null; height: number | null; variants: { width: number; url: string }[] };
export type Site = {
  installed: boolean; app_name: string; app_description: string; app_url: string; institution_name: string;
  contact_email: string | null; contact_phone: string | null; address: string | null; default_language: string;
  branding: {
    colors: Record<'primary_navy' | 'dark_navy' | 'primary' | 'secondary' | 'light' | 'surface' | 'background' | 'text_primary' | 'text_secondary' | 'success' | 'warning' | 'danger', string>;
    font_body: string; font_heading: string; button_radius: number; card_radius: number; tagline: string; footer_text: string;
  };
  assets: Partial<Record<'institution_logo' | 'logo_light' | 'favicon' | 'login_background' | 'dashboard_banner', MediaItem>>;
  modules: Record<string, boolean>;
};

export async function getSite(): Promise<Site | null> {
  try {
    const r = await fetch(`${API}/api/v1/public/site`, { next: { revalidate: 15 }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    return (await r.json()).data as Site;
  } catch {
    return null;
  }
}

const rgb = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};

export function themeCss(s: Site): string {
  const c = s.branding.colors;
  const font = (f: string) => (f === 'System' ? 'system-ui' : `'${f}'`);
  return `:root{--navy:${rgb(c.primary_navy)};--navy-dark:${rgb(c.dark_navy)};--primary:${rgb(c.primary)};--secondary:${rgb(c.secondary)};` +
    `--primary-light:${rgb(c.light)};--surface:${rgb(c.surface)};--canvas:${rgb(c.background)};--ink:${rgb(c.text_primary)};` +
    `--ink-muted:${rgb(c.text_secondary)};--success:${rgb(c.success)};--line:230 232 240;--radius-btn:${s.branding.button_radius}px;` +
    `--radius-card:${s.branding.card_radius}px;--font-body:${font(s.branding.font_body)};--font-heading:${font(s.branding.font_heading)}}`;
}

export const pick = (m: MediaItem | undefined, w: number) => m && (m.variants.find((v) => v.width >= w)?.url ?? m.url);

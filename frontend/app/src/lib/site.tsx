import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { hexToRgb } from './utils';

export type Colors = {
  primary_navy: string; dark_navy: string; primary: string; secondary: string; light: string; surface: string;
  background: string; text_primary: string; text_secondary: string; success: string; warning: string; danger: string;
};
export type Branding = {
  colors: Colors; font_body: string; font_heading: string; button_radius: number; card_radius: number;
  color_mode: 'light' | 'dark' | 'system'; tagline: string; footer_text: string;
  institution_logo: string | null; logo_light: string | null; logo_dark: string | null; favicon: string | null;
  login_background: string | null; dashboard_banner: string | null;
};
export type MediaItem = {
  id: string; url: string; filename: string; mime: string; size: number; width: number | null; height: number | null;
  alt: string; folder: string; variants: { width: number; height: number; url: string }[]; created_at: string;
};
export type Site = {
  installed: boolean; app_name: string; app_description: string; app_url: string; institution_name: string;
  contact_email: string | null; contact_phone: string | null; address: string | null; default_language: string;
  timezone: string; date_format: string; time_format: string; currency: string; branding: Branding;
  branding_version: number; assets: Partial<Record<keyof Branding, MediaItem>>; modules: Record<string, boolean>;
  features: Record<string, boolean>; terms_url?: string | null;
  auth: { require_email_verification: boolean; require_phone_verification: boolean; min_password_length: number;
    require_uppercase: boolean; require_lowercase: boolean; require_digit: boolean; require_symbol: boolean };
};

const SiteContext = createContext<Site | null>(null);

export function useSite() {
  const s = useContext(SiteContext);
  if (!s) throw new Error('useSite outside SiteProvider');
  return s;
}

/** Writes branding to CSS variables. Used for the live site and for the branding live preview. */
export function themeVars(b: Branding): Record<string, string> {
  const c = b.colors;
  const font = (f: string) => (f === 'System' ? 'system-ui' : `'${f}'`);
  return {
    '--navy': hexToRgb(c.primary_navy), '--navy-dark': hexToRgb(c.dark_navy), '--primary': hexToRgb(c.primary),
    '--secondary': hexToRgb(c.secondary), '--primary-light': hexToRgb(c.light), '--surface': hexToRgb(c.surface),
    '--canvas': hexToRgb(c.background), '--ink': hexToRgb(c.text_primary), '--ink-muted': hexToRgb(c.text_secondary),
    '--success': hexToRgb(c.success), '--warning': hexToRgb(c.warning), '--danger': hexToRgb(c.danger),
    '--line': '230 232 240', '--radius-btn': `${b.button_radius}px`, '--radius-card': `${b.card_radius}px`,
    '--font-body': font(b.font_body), '--font-heading': font(b.font_heading),
  };
}

export function applyTheme(el: HTMLElement, b: Branding) {
  for (const [k, v] of Object.entries(themeVars(b))) el.style.setProperty(k, v);
}

export function SiteProvider({ children }: { children: ReactNode }) {
  // no-cache: always revalidate with the server (branding/installation changes must show immediately)
  const q = useQuery({
    queryKey: ['site'],
    queryFn: async () => (await api<{ data: Site }>('/api/v1/public/site', { cache: 'no-cache' })).data,
    staleTime: 30_000,
  });
  const site = q.data;

  useEffect(() => {
    if (!site) return;
    applyTheme(document.documentElement, site.branding);
    document.title = site.app_name;
    const fav = site.assets.favicon?.url ?? site.assets.institution_logo?.url;
    if (fav) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) link = Object.assign(document.createElement('link'), { rel: 'icon' });
      link.href = fav;
      document.head.appendChild(link);
    }
  }, [site]);

  if (q.isError) {
    return (
      <div className="grid min-h-screen place-items-center bg-canvas p-6 text-center">
        <div>
          <p className="font-heading text-lg font-semibold text-ink">The service is starting up</p>
          <p className="mt-1 text-sm text-ink-muted">Please refresh this page in a moment.</p>
          <button className="mt-4 rounded-btn bg-primary px-4 py-2 text-sm font-medium text-white" onClick={() => q.refetch()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!site) return <FullPageSpinner />;
  return <SiteContext.Provider value={site}>{children}</SiteContext.Provider>;
}

export function FullPageSpinner() {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas" role="status" aria-label="Loading">
      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/25 border-t-primary" />
    </div>
  );
}

/** Best rendition of an image for a given display width. */
export function pickVariant(m: MediaItem | undefined | null, width: number) {
  if (!m) return undefined;
  return m.variants.find((v) => v.width >= width)?.url ?? m.url;
}

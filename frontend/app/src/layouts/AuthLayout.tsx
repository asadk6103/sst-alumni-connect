import type { ReactNode } from 'react';
import { BrandMark } from '@/components/brand';
import { pickVariant, useSite } from '@/lib/site';
import { LanguageSwitcher, useT } from '@/lib/i18n';

/** Split sign-in layout from the design: campus image on the left, form card on the right. */
export function AuthLayout({ title, subtitle, children, footer, wide }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const site = useSite();
  const t = useT();
  const bg = site.assets.login_background;
  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-navy lg:block" aria-hidden>
        {bg ? (
          <img src={pickVariant(bg, 1200)} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgb(var(--secondary)/0.45),transparent_45%),radial-gradient(circle_at_80%_80%,rgb(var(--primary)/0.35),transparent_40%)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-navy-dark/85 via-navy-dark/25 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-10 text-white">
          <p className="font-heading text-3xl font-semibold leading-tight">
            {site.app_name.replace(/Connect$/, '')}<span className="text-secondary">{site.app_name.endsWith('Connect') ? 'Connect' : ''}</span>
          </p>
          <p className="mt-2 max-w-md text-[15px] text-white/85">{site.branding.tagline}</p>
        </div>
      </aside>
      <main className="relative flex items-center justify-center px-4 py-10 sm:px-8">
        <LanguageSwitcher className="absolute end-4 top-4" />
        <div className={wide ? "w-full max-w-[640px]" : "w-full max-w-[420px]"}>
          <div className="mb-6 flex flex-col items-center text-center">
            <BrandMark size={52} />
            <p className="mt-4 font-heading text-base font-semibold text-ink">{t('site.portal', 'Alumni Portal')}</p>
          </div>
          <div className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-7">
            <h1 className="text-center font-heading text-xl font-semibold text-ink">{title}</h1>
            {subtitle && <p className="mt-1.5 text-center text-sm text-ink-muted">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
          {footer && <div className="mt-5 text-center text-sm text-ink-muted">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

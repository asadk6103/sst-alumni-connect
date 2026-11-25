import type { ReactNode } from 'react';
import { Briefcase, CalendarDays, Users, UsersRound } from 'lucide-react';
import { BrandMark } from '@/components/brand';
import { pickVariant, useSite } from '@/lib/site';
import { LanguageSwitcher, useT } from '@/lib/i18n';

/** Sign-in layout from the design: campus photo with purple waves on the left, white card on the right. */
export function AuthLayout({ title, subtitle, children, footer, wide }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const site = useSite();
  const t = useT();
  const bg = site.assets.login_background ?? site.assets.dashboard_banner;
  const tagline = (site.branding.tagline || 'Reconnect. Network. Collaborate. Give Back.').replace(/\.\s*/g, ' • ').replace(/ • $/, '');
  const features = [
    { icon: Users, label: t('login.stay', 'Stay Connected') }, { icon: CalendarDays, label: t('login.events', 'Join Events') },
    { icon: Briefcase, label: t('login.opportunities', 'Explore Opportunities') }, { icon: UsersRound, label: t('login.communities', 'Build Communities') },
  ];
  const email = site.contact_email;
  return (
    <div className="relative grid min-h-screen overflow-hidden bg-[#f3efff] lg:grid-cols-[1.12fr_1fr]">
      <aside className="relative hidden overflow-hidden lg:block" aria-hidden>
        {bg ? <img src={pickVariant(bg, 1600)} alt="" className="absolute inset-0 h-full w-full object-cover" />
          : <div className="absolute inset-0 bg-gradient-to-br from-navy to-primary" />}
        <div className="absolute inset-0 bg-gradient-to-t from-[#2a1260]/90 via-[#2a1260]/20 to-transparent" />
        {/* purple waves */}
        <svg className="absolute -right-24 -top-10 h-[45%] w-[70%] text-[#c9b3ff]/70" viewBox="0 0 400 300" preserveAspectRatio="none"><path fill="currentColor" d="M400 0H140c40 70 140 90 160 170 18 70 70 110 100 130V0z" /></svg>
        <svg className="absolute -bottom-6 left-0 h-[30%] w-full text-primary/70" viewBox="0 0 600 200" preserveAspectRatio="none"><path fill="currentColor" d="M0 200V90c120 60 260-40 380 10 90 38 160 20 220-20v120z" /></svg>
        <div className="absolute inset-x-0 bottom-0 p-10 pb-16 text-white xl:p-14 xl:pb-20">
          <span className="mb-5 block h-1.5 w-32 rounded-full bg-primary" />
          <p className="font-heading text-5xl font-bold leading-tight">{site.app_name.replace(/Connect$/, 'Portal')}</p>
          <p className="mt-3 text-xl text-white/90">{tagline}</p>
          <ul className="mt-8 flex max-w-xl divide-x divide-white/25">
            {features.map((f) => <li key={f.label} className="flex flex-1 flex-col items-center gap-2 px-3 text-center text-[15px] leading-tight"><f.icon className="h-8 w-8" />{f.label}</li>)}
          </ul>
        </div>
      </aside>
      <main className="relative flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="absolute end-4 top-4"><LanguageSwitcher /></div>
        <div className={wide ? 'w-full max-w-[680px]' : 'w-full max-w-[560px]'}>
          <div className="rounded-[24px] bg-surface px-6 py-8 shadow-[0_20px_60px_rgb(76_29_149/0.12)] sm:px-12 sm:py-10">
            <div className="flex flex-col items-center text-center">
              <BrandMark size={72} className="[&_span]:text-[26px] [&_span]:text-navy" />
              <p className="mt-3 flex items-center gap-3 font-heading text-xl font-semibold text-primary"><span className="h-px w-16 bg-primary/60" />{t('site.portal', 'Alumni Portal')}<span className="h-px w-16 bg-primary/60" /></p>
            </div>
            <h1 className="mt-7 text-center font-heading text-[34px] font-bold leading-tight text-navy">{title}</h1>
            {subtitle && <p className="mt-2 text-center text-[17px] text-ink-muted">{subtitle}</p>}
            <div className="mt-7">{children}</div>
            {footer && <div className="mt-7 text-center text-[15px] text-ink">{footer}</div>}
            <nav className="mt-8 flex justify-center divide-x divide-line text-sm text-ink-muted" aria-label="Help">
              {email && <a className="px-3 hover:text-primary" href={`mailto:${email}`}>{t('login.help', 'Help & Support')}</a>}
              {site.terms_url && <a className="px-3 hover:text-primary" href={site.terms_url} target="_blank" rel="noopener noreferrer">{t('login.privacy', 'Privacy Policy')}</a>}
              {site.terms_url && <a className="px-3 hover:text-primary" href={site.terms_url} target="_blank" rel="noopener noreferrer">{t('login.terms', 'Terms of Use')}</a>}
            </nav>
          </div>
        </div>
      </main>
    </div>
  );
}

import type { ReactNode } from 'react';
import { ChevronDown, Facebook, GraduationCap, Instagram, Linkedin, Lock, Mail, MapPin, Phone, Twitter, Youtube } from 'lucide-react';
import { apiGet, currentLang, i18n, type NavLink, type T, type Website } from '@/lib/api';
import { getSite, pick, type Site } from '@/lib/site';
import { LanguageSwitch, MobileMenu } from './client';

type Ctx = { site: Site; web: Website | null; t: T; lang: string; rtl: boolean };

/** Everything a public page needs: settings, menus, language. Fetches are de-duplicated per request. */
export async function context(): Promise<Ctx | null> {
  const site = await getSite();
  if (!site) return null;
  const { t, rtl, lang } = await i18n(await currentLang(site.default_language));
  const web = await apiGet<Website>(`/api/v1/public/website?lang=${lang}`);
  return { site, web, t, lang, rtl };
}

const label = (l: NavLink, t: T) => (l.i18n ? t(l.i18n, l.label) : l.label);

export async function Shell({ children, ctx }: { children: ReactNode; ctx: Ctx }) {
  const { site, web, t, lang } = ctx;
  const languages = (await apiGet<{ code: string; native_name: string }[]>('/api/v1/public/languages', 60)) ?? [];
  const logo = site.assets.logo_light ?? site.assets.institution_logo;
  const links = web?.header ?? [];
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <header className="relative bg-navy text-white">
        <div className="mx-auto flex h-[72px] max-w-[1200px] items-center gap-4 px-4 sm:px-6">
          <a href="/" className="flex min-w-0 items-center gap-3">
            {logo ? <img src={pick(logo, 96)} alt={`${site.institution_name} logo`} className="h-11 w-auto shrink-0" /> : <GraduationCap className="h-9 w-9 shrink-0" />}
            <span className="hidden truncate font-heading text-[15px] font-semibold leading-tight sm:block">{site.institution_name}</span>
          </a>
          <nav aria-label="Main" className="ms-auto hidden h-full items-stretch lg:flex">
            {links.map((l) => l.children.length ? (
              <div key={l.href + l.label} className="group relative flex items-center">
                <a href={l.href} className="flex items-center gap-1 px-3 text-sm font-medium text-white/85 hover:text-white">{label(l, t)}<ChevronDown className="h-3.5 w-3.5" /></a>
                <div className="invisible absolute start-0 top-full z-40 min-w-[200px] rounded-card bg-surface py-2 text-ink opacity-0 shadow-lg transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                  {l.children.map((c) => <a key={c.href + c.label} href={c.href} target={c.new_tab ? '_blank' : undefined} rel={c.new_tab ? 'noopener noreferrer' : undefined} className="block px-4 py-2 text-sm hover:bg-canvas">{label(c, t)}</a>)}
                </div>
              </div>
            ) : <a key={l.href + l.label} href={l.href} target={l.new_tab ? '_blank' : undefined} rel={l.new_tab ? 'noopener noreferrer' : undefined} className="flex items-center px-3 text-sm font-medium text-white/85 hover:text-white">{label(l, t)}</a>)}
          </nav>
          <div className="ms-auto flex items-center gap-3 lg:ms-2">
            <LanguageSwitch lang={lang} languages={languages} label={t('common.language', 'Language')} />
            <a href="/login" className="hidden items-center gap-2 rounded-btn bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 sm:inline-flex"><Lock className="h-4 w-4" />{t('site.sign_in', 'Sign in')}</a>
            <MobileMenu links={links.flatMap((l) => [{ ...l, label: label(l, t) }, ...l.children.map((c) => ({ ...c, label: label(c, t) }))])} signIn={t('site.sign_in', 'Sign in')} join={t('site.join', 'Join the network')} />
          </div>
        </div>
      </header>
      <main id="main">{children}</main>
      <Footer ctx={ctx} />
    </>
  );
}

const SOCIAL: Record<string, typeof Facebook> = { facebook: Facebook, instagram: Instagram, linkedin: Linkedin, youtube: Youtube, x: Twitter };

function Footer({ ctx }: { ctx: Ctx }) {
  const { site, web, t } = ctx;
  const contact = web?.contact ?? { email: site.contact_email, phone: site.contact_phone, address: site.address };
  return (
    <footer className="bg-navy-dark text-white/80">
      <div className="mx-auto grid max-w-[1200px] gap-8 px-4 py-10 sm:px-6 md:grid-cols-3">
        <div>
          <p className="font-heading text-lg font-semibold text-white">{site.app_name}</p>
          <p className="mt-1 text-sm">{web?.footer_text || site.branding.tagline}</p>
          {web && Object.keys(web.social).length > 0 && (
            <ul className="mt-4 flex gap-2">{Object.entries(web.social).map(([k, href]) => { const Icon = SOCIAL[k] ?? Mail; return (
              <li key={k}><a href={href} target="_blank" rel="noopener noreferrer" aria-label={k} className="grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20"><Icon className="h-4 w-4" /></a></li>); })}</ul>
          )}
        </div>
        <nav aria-label="Footer"><ul className="grid grid-cols-2 gap-2 text-sm">{(web?.footer ?? []).map((l) => <li key={l.href + l.label}><a href={l.href} className="hover:text-white">{label(l, t)}</a></li>)}</ul></nav>
        <ul className="space-y-2 text-sm md:justify-self-end">
          {contact.address && <li className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{contact.address}</li>}
          {contact.phone && <li className="flex items-center gap-2"><Phone className="h-4 w-4" /><a href={`tel:${contact.phone}`} className="hover:text-white" dir="ltr">{contact.phone}</a></li>}
          {contact.email && <li className="flex items-center gap-2"><Mail className="h-4 w-4" /><a href={`mailto:${contact.email}`} className="hover:text-white">{contact.email}</a></li>}
        </ul>
      </div>
      <div className="border-t border-white/10 py-4 text-center text-xs text-white/55">
        {site.branding.footer_text || `© ${new Date().getFullYear()} ${site.institution_name}. ${t('site.all_rights', 'All rights reserved.')}`}
      </div>
    </footer>
  );
}

export function Unavailable() {
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <p className="font-heading text-lg font-semibold">The alumni portal is starting up</p>
        <p className="mt-1 text-sm text-ink-muted">Please refresh in a moment.</p>
      </div>
    </main>
  );
}

export function PageTitle({ title, intro, children }: { title: string; intro?: string; children?: ReactNode }) {
  return (
    <section className="bg-navy text-white">
      <div className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6 lg:py-16">
        <h1 className="font-heading text-3xl font-semibold sm:text-4xl">{title}</h1>
        {intro && <p className="mt-3 max-w-2xl text-white/80">{intro}</p>}
        {children}
      </div>
    </section>
  );
}

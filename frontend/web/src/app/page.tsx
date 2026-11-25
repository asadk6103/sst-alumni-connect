import type { Metadata } from 'next';
import { ArrowRight, Briefcase, CalendarDays, GraduationCap, HandHeart, Mail, Users } from 'lucide-react';
import { apiGet, imgSrc, type CmsPage } from '@/lib/api';
import { pick } from '@/lib/site';
import { Blocks } from '@/components/blocks';
import { Shell, Unavailable, context } from '@/components/shell';

// Home: the CMS page chosen in Configuration → Public website, else the built-in landing page.
export async function generateMetadata(): Promise<Metadata> {
  const home = await apiGet<CmsPage | null>('/api/v1/public/home');
  if (!home) return {};
  return { title: { absolute: home.seo_title }, description: home.seo_description || undefined,
    openGraph: home.featured_image ? { images: [imgSrc(home.featured_image, 1200)!] } : undefined };
}

export default async function Home() {
  const ctx = await context();
  if (!ctx) return <Unavailable />;
  const { site, t, lang } = ctx;
  const home = await apiGet<CmsPage | null>('/api/v1/public/home');
  if (home) return <Shell ctx={ctx}><Blocks blocks={home.blocks} t={t} lang={lang} /></Shell>;

  const hero = site.assets.login_background ?? site.assets.dashboard_banner;
  const [first, ...rest] = site.app_name.split(' ');
  const last = rest.pop();
  const features = [
    { module: 'directory', icon: Users, title: t('site.reconnect', 'Reconnect'), text: 'Find classmates and batchmates across cities and countries.' },
    { module: 'jobs', icon: Briefcase, title: t('site.network', 'Network'), text: 'Share opportunities and refer fellow SSTians.' },
    { module: 'mentorship', icon: GraduationCap, title: t('site.mentor', 'Mentor'), text: 'Guide current students and young alumni.' },
    { module: 'donations', icon: HandHeart, title: t('site.give_back', 'Give back'), text: 'Support scholarships and the school community.' },
    { module: 'events', icon: CalendarDays, title: t('site.come_together', 'Come together'), text: 'Reunions, seminars and networking events.' },
  ].filter((f) => site.modules[f.module] !== false);
  return (
    <Shell ctx={ctx}>
      <section className="relative overflow-hidden bg-navy text-white">
        {hero && <img src={pick(hero, 1920)} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />}
        <div className="absolute inset-0 bg-gradient-to-r from-navy-dark via-navy-dark/85 to-navy-dark/30 rtl:bg-gradient-to-l" />
        <div className="relative mx-auto max-w-[1200px] px-4 py-20 sm:px-6 lg:py-28">
          <h1 className="font-heading text-4xl font-semibold leading-tight sm:text-5xl">{first} {rest.join(' ')} {last && <span className="text-secondary">{last}</span>}</h1>
          <p className="mt-4 max-w-xl text-lg text-white/85">{site.app_description || site.branding.tagline}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="/login" className="inline-flex items-center gap-2 rounded-btn bg-primary px-5 py-3 font-medium text-white hover:bg-primary/90">{t('site.sign_in', 'Sign in')}<ArrowRight className="h-4 w-4 rtl:rotate-180" /></a>
            <a href="/register" className="inline-flex items-center gap-2 rounded-btn border border-white/70 px-5 py-3 font-medium text-white hover:bg-white/10">{t('site.join', 'Join the alumni network')}</a>
            {site.contact_email && <a href="/contact" className="inline-flex items-center gap-2 rounded-btn border border-white/70 px-5 py-3 font-medium text-white hover:bg-white/10"><Mail className="h-4 w-4" />{t('site.contact', 'Contact')}</a>}
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6" aria-labelledby="why">
        <h2 id="why" className="text-center font-heading text-2xl font-semibold text-ink">{site.branding.tagline}</h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-ink-muted">A lifelong community for former students of {site.institution_name}.</p>
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {features.map((f) => (
            <li key={f.module} className="rounded-card border border-line bg-surface p-5 shadow-card">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-primary-soft text-primary"><f.icon className="h-6 w-6" /></span>
              <h3 className="mt-4 font-heading text-base font-semibold text-ink">{f.title}</h3>
              <p className="mt-1 text-sm text-ink-muted">{f.text}</p>
            </li>
          ))}
        </ul>
      </section>
    </Shell>
  );
}

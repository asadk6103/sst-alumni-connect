import { ArrowRight, Briefcase, CalendarDays, GraduationCap, HandHeart, Lock, Mail, MapPin, Phone, Users } from 'lucide-react';
import { getSite, pick, type Site } from '@/lib/site';

// Landing page built from the institution's settings and branding. Content pages (about,
// distinguished alumni, news, events, gallery) are managed in the CMS from Stage 5.

const FEATURES: { module: string | null; icon: typeof Users; title: string; text: string }[] = [
  { module: 'directory', icon: Users, title: 'Reconnect', text: 'Find classmates and batchmates across cities and countries.' },
  { module: 'jobs', icon: Briefcase, title: 'Network', text: 'Share opportunities and refer fellow SSTians.' },
  { module: 'mentorship', icon: GraduationCap, title: 'Mentor', text: 'Guide current students and young alumni.' },
  { module: 'donations', icon: HandHeart, title: 'Give back', text: 'Support scholarships and the school community.' },
  { module: 'events', icon: CalendarDays, title: 'Come together', text: 'Reunions, seminars and networking events.' },
];

export default async function Home() {
  const site = await getSite();
  if (!site) return <Unavailable />;
  const logo = site.assets.logo_light ?? site.assets.institution_logo;
  const hero = site.assets.login_background ?? site.assets.dashboard_banner;
  const [first, ...rest] = site.app_name.split(' ');
  const last = rest.pop();
  const features = FEATURES.filter((f) => !f.module || site.modules[f.module] !== false);

  return (
    <>
      <header className="bg-navy text-white">
        <div className="mx-auto flex h-[72px] max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6">
          <a href="/" className="flex min-w-0 items-center gap-3">
            {logo ? <img src={pick(logo, 96)} alt={`${site.institution_name} logo`} className="h-11 w-auto shrink-0" /> : <GraduationCap className="h-9 w-9" />}
            <span className="truncate font-heading text-[15px] font-semibold leading-tight">{site.institution_name}</span>
            <span className="hidden h-8 w-px bg-white/20 sm:block" />
            <span className="hidden font-heading text-[15px] font-semibold sm:block">Alumni Portal</span>
          </a>
          <a href="/login" className="inline-flex shrink-0 items-center gap-2 rounded-btn bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90">
            <Lock className="h-4 w-4" />Sign in
          </a>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden bg-navy text-white">
          {hero && <img src={pick(hero, 1920)} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />}
          <div className="absolute inset-0 bg-gradient-to-r from-navy-dark via-navy-dark/85 to-navy-dark/30" />
          <div className="relative mx-auto max-w-[1200px] px-4 py-20 sm:px-6 lg:py-28">
            <h1 className="font-heading text-4xl font-semibold leading-tight sm:text-5xl">
              {first} {rest.join(' ')} {last && <span className="text-secondary">{last}</span>}
            </h1>
            <p className="mt-4 max-w-xl text-lg text-white/85">{site.app_description || site.branding.tagline}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="/login" className="inline-flex items-center gap-2 rounded-btn bg-primary px-5 py-3 font-medium text-white hover:bg-primary/90">
                Sign in to the portal<ArrowRight className="h-4 w-4" />
              </a>
              {site.contact_email && (
                <a href={`mailto:${site.contact_email}`} className="inline-flex items-center gap-2 rounded-btn border border-white/70 px-5 py-3 font-medium text-white hover:bg-white/10">
                  <Mail className="h-4 w-4" />Contact the alumni office
                </a>
              )}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6" aria-labelledby="why">
          <h2 id="why" className="text-center font-heading text-2xl font-semibold text-ink">{site.branding.tagline}</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-ink-muted">A lifelong community for former students of {site.institution_name}.</p>
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
            {features.map((f) => (
              <li key={f.title} className="rounded-card border border-line bg-surface p-5 shadow-card">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-primary-soft text-primary"><f.icon className="h-6 w-6" /></span>
                <h3 className="mt-4 font-heading text-base font-semibold text-ink">{f.title}</h3>
                <p className="mt-1 text-sm text-ink-muted">{f.text}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <Footer site={site} />
    </>
  );
}

function Footer({ site }: { site: Site }) {
  return (
    <footer className="bg-navy-dark text-white/80">
      <div className="mx-auto grid max-w-[1200px] gap-8 px-4 py-10 sm:grid-cols-2 sm:px-6">
        <div>
          <p className="font-heading text-lg font-semibold text-white">{site.app_name}</p>
          <p className="mt-1 text-sm">{site.branding.tagline}</p>
        </div>
        <ul className="space-y-2 text-sm sm:justify-self-end">
          {site.address && <li className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{site.address}</li>}
          {site.contact_phone && <li className="flex items-center gap-2"><Phone className="h-4 w-4" /><a href={`tel:${site.contact_phone}`} className="hover:text-white">{site.contact_phone}</a></li>}
          {site.contact_email && <li className="flex items-center gap-2"><Mail className="h-4 w-4" /><a href={`mailto:${site.contact_email}`} className="hover:text-white">{site.contact_email}</a></li>}
        </ul>
      </div>
      <div className="border-t border-white/10 py-4 text-center text-xs text-white/55">
        {site.branding.footer_text || `© ${new Date().getFullYear()} ${site.institution_name}`}
      </div>
    </footer>
  );
}

function Unavailable() {
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <p className="font-heading text-lg font-semibold">The alumni portal is starting up</p>
        <p className="mt-1 text-sm text-ink-muted">Please refresh in a moment.</p>
      </div>
    </main>
  );
}

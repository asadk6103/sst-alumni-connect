import { ArrowRight, CalendarDays, Images, Mail, MapPin, Monitor, Newspaper, Phone, Quote } from 'lucide-react';
import { fmtDate, imgSrc, type Achievement, type Album, type Block, type EventCard, type Img, type NewsCard, type T } from '@/lib/api';
import { ContactForm, NewsletterForm } from './client';

const Section = ({ heading, children, tint }: { heading?: string; children: React.ReactNode; tint?: boolean }) => (
  <section className={tint ? 'bg-canvas' : 'bg-surface'}>
    <div className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6">
      {heading && <h2 className="mb-8 font-heading text-2xl font-semibold text-ink sm:text-3xl">{heading}</h2>}
      {children}
    </div>
  </section>
);

const Btn = ({ href, label, variant = 'primary' }: { href?: unknown; label?: unknown; variant?: 'primary' | 'outline' | 'white' }) => {
  if (!href || !label) return null;
  const cls = variant === 'primary' ? 'bg-primary text-white hover:bg-primary/90' : variant === 'white' ? 'bg-white text-navy hover:bg-white/90' : 'border border-white/70 text-white hover:bg-white/10';
  const ext = String(href).startsWith('http');
  return <a href={String(href)} target={ext ? '_blank' : undefined} rel={ext ? 'noopener noreferrer' : undefined} className={`inline-flex items-center gap-2 rounded-btn px-5 py-3 font-medium ${cls}`}>{String(label)}<ArrowRight className="h-4 w-4 rtl:rotate-180" /></a>;
};

const Prose = ({ html }: { html: unknown }) => <div className="prose-site" dangerouslySetInnerHTML={{ __html: String(html ?? '') }} />;

const Avatar = ({ img, name, size = 64 }: { img: Img; name: string; size?: number }) => img
  ? <img src={imgSrc(img, size * 2)} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  : <span className="grid shrink-0 place-items-center rounded-full bg-primary-soft font-heading font-semibold text-primary" style={{ width: size, height: size }}>{name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>;

export function NewsCardView({ n, t, lang }: { n: NewsCard; t: T; lang: string }) {
  const cat: Record<string, string> = { news: t('site.news', 'News'), announcement: 'Announcement', success_story: t('site.success_stories', 'Success story') };
  return (
    <a href={`/news/${n.slug}`} className="group flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card transition-shadow hover:shadow-md">
      {n.cover ? <img src={imgSrc(n.cover, 640)} alt="" loading="lazy" className="aspect-[16/9] w-full object-cover" /> : <div className="grid aspect-[16/9] place-items-center bg-primary-soft"><Newspaper className="h-8 w-8 text-primary" /></div>}
      <div className="flex flex-1 flex-col p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-primary">{cat[n.category] ?? n.category} · <span className="text-ink-muted">{fmtDate(n.published_at, lang)}</span></p>
        <h3 className="mt-2 font-heading text-lg font-semibold text-ink group-hover:text-primary">{n.title}</h3>
        <p className="mt-1 line-clamp-3 text-sm text-ink-muted">{n.summary}</p>
      </div>
    </a>
  );
}

export function EventCardView({ e, t, lang }: { e: EventCard; t: T; lang: string }) {
  return (
    <a href={`/events/${e.id}`} className="group flex overflow-hidden rounded-card border border-line bg-surface shadow-card transition-shadow hover:shadow-md">
      <div className="flex w-20 shrink-0 flex-col items-center justify-center bg-navy text-white">
        <span className="font-heading text-2xl font-semibold">{fmtDate(e.starts_at, lang, { day: 'numeric' })}</span>
        <span className="text-xs uppercase">{fmtDate(e.starts_at, lang, { month: 'short' })}</span>
      </div>
      <div className="min-w-0 flex-1 p-4">
        <h3 className="font-heading font-semibold text-ink group-hover:text-primary">{e.title}</h3>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-muted">{e.is_online ? <><Monitor className="h-4 w-4" />{t('site.online', 'Online')}</> : <><MapPin className="h-4 w-4" />{e.venue}</>}</p>
        {e.summary && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{e.summary}</p>}
      </div>
    </a>
  );
}

export function AlbumCardView({ a, t }: { a: Album; t: T }) {
  return (
    <a href={`/gallery/${a.id}`} className="group overflow-hidden rounded-card border border-line bg-surface shadow-card">
      {a.cover ? <img src={imgSrc(a.cover, 640)} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-[1.02]" /> : <div className="grid aspect-[4/3] place-items-center bg-canvas"><Images className="h-8 w-8 text-ink-muted" /></div>}
      <div className="p-4"><h3 className="font-medium text-ink">{a.title}</h3><p className="text-sm text-ink-muted">{a.photo_count} {t('site.photos', 'photos')}</p></div>
    </a>
  );
}

export function AchievementCard({ a }: { a: Achievement }) {
  return (
    <article className="flex flex-col rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center gap-3">
        <Avatar img={a.person?.photo ?? a.image} name={a.person?.full_name ?? a.title} size={56} />
        <div className="min-w-0"><p className="font-heading font-semibold text-ink">{a.person?.full_name}</p><p className="text-xs text-ink-muted">{[a.person?.batch, a.kind_label].filter(Boolean).join(' · ')}</p></div>
      </div>
      <h3 className="mt-4 font-medium text-ink">{a.title}</h3>
      <p className="mt-1 text-sm text-ink-muted">{a.summary}</p>
    </article>
  );
}

export function Blocks({ blocks, t, lang }: { blocks: Block[]; t: T; lang: string }) {
  let tint = false;
  return <>{blocks.map((b) => { tint = !tint; return <BlockView key={b.id} b={b} t={t} lang={lang} tint={tint} />; })}</>;
}

function BlockView({ b, t, lang, tint }: { b: Block; t: T; lang: string; tint: boolean }) {
  const items = (b.items as unknown[]) ?? [];
  switch (b.type) {
    case 'hero': {
      const img = b.image as Img;
      const center = b.align === 'center';
      return (
        <section className="relative overflow-hidden bg-navy text-white">
          {img && <img src={imgSrc(img, 1920)} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          <div className="absolute inset-0 bg-navy-dark" style={{ opacity: img ? Number(b.overlay ?? 60) / 100 : 1 }} />
          <div className={`relative mx-auto max-w-[1200px] px-4 py-20 sm:px-6 lg:py-28 ${center ? 'text-center' : ''}`}>
            <h1 className="font-heading text-4xl font-semibold leading-tight sm:text-5xl">{b.heading}</h1>
            {!!b.subheading && <p className={`mt-4 max-w-2xl text-lg text-white/85 ${center ? 'mx-auto' : ''}`}>{String(b.subheading)}</p>}
            <div className={`mt-8 flex flex-wrap gap-3 ${center ? 'justify-center' : ''}`}><Btn href={b.button_url} label={b.button_label} /><Btn href={b.secondary_url} label={b.secondary_label} variant="outline" /></div>
          </div>
        </section>
      );
    }
    case 'image_text': {
      const img = b.image as Img;
      return (
        <Section tint={tint}>
          <div className="grid items-center gap-10 md:grid-cols-2">
            <div className={b.image_side === 'right' ? 'md:order-2' : ''}>{img ? <img src={imgSrc(img, 960)} alt={img.alt ?? ''} className="w-full rounded-card object-cover shadow-card" /> : <div className="aspect-[4/3] rounded-card bg-primary-soft" />}</div>
            <div>{b.heading && <h2 className="mb-4 font-heading text-2xl font-semibold text-ink sm:text-3xl">{b.heading}</h2>}<Prose html={b.html} /><div className="mt-6"><Btn href={b.button_url} label={b.button_label} /></div></div>
          </div>
        </Section>
      );
    }
    case 'rich_text':
      return <Section heading={b.heading} tint={tint}><div className="max-w-3xl"><Prose html={b.html} /></div></Section>;
    case 'stats':
      return (
        <Section heading={b.heading} tint={tint}>
          <dl className="grid grid-cols-2 gap-5 lg:grid-cols-4">
            {(items as { label: string; value: string }[]).map((s) => <div key={s.label} className="rounded-card border border-line bg-surface p-6 text-center shadow-card"><dd className="font-heading text-3xl font-semibold text-primary">{s.value || '—'}</dd><dt className="mt-1 text-sm text-ink-muted">{s.label}</dt></div>)}
          </dl>
        </Section>
      );
    case 'alumni_profiles':
      return (
        <Section heading={b.heading} tint={tint}>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {(items as { name: string; title: string; batch: string; text: string; photo: Img }[]).map((p) => (
              <article key={p.name} className="rounded-card border border-line bg-surface p-5 text-center shadow-card">
                <div className="flex justify-center"><Avatar img={p.photo} name={p.name} size={88} /></div>
                <h3 className="mt-3 font-heading font-semibold text-ink">{p.name}</h3><p className="text-sm text-primary">{p.title}</p>{p.batch && <p className="text-xs text-ink-muted">{p.batch}</p>}
                {p.text && <p className="mt-2 text-sm text-ink-muted">{p.text}</p>}
              </article>
            ))}
          </div>
        </Section>
      );
    case 'featured_alumni':
      return items.length ? <Section heading={b.heading} tint={tint}><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{(items as Achievement[]).map((a) => <AchievementCard key={a.id} a={a} />)}</div></Section> : null;
    case 'events':
      return (
        <Section heading={b.heading} tint={tint}>
          {items.length ? <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{(items as EventCard[]).map((e) => <EventCardView key={e.id} e={e} t={t} lang={lang} />)}</div>
            : <p className="flex items-center gap-2 text-ink-muted"><CalendarDays className="h-5 w-5" />{t('site.no_events', 'No upcoming events right now.')}</p>}
          <a href="/events" className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">{t('common.view_all', 'View all')}<ArrowRight className="h-4 w-4 rtl:rotate-180" /></a>
        </Section>
      );
    case 'news':
      return items.length ? (
        <Section heading={b.heading} tint={tint}>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{(items as NewsCard[]).map((n) => <NewsCardView key={n.id} n={n} t={t} lang={lang} />)}</div>
          <a href="/news" className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">{t('common.view_all', 'View all')}<ArrowRight className="h-4 w-4 rtl:rotate-180" /></a>
        </Section>
      ) : null;
    case 'gallery':
      return items.length ? <Section heading={b.heading} tint={tint}><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{(items as Album[]).map((a) => <AlbumCardView key={a.id} a={a} t={t} />)}</div></Section> : null;
    case 'testimonials':
      return (
        <Section heading={b.heading} tint={tint}>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {(items as { quote: string; name: string; role: string; photo: Img }[]).map((q) => (
              <figure key={q.name + q.quote.slice(0, 10)} className="flex flex-col rounded-card border border-line bg-surface p-6 shadow-card">
                <Quote className="h-6 w-6 text-primary/50" aria-hidden />
                <blockquote className="mt-3 flex-1 text-ink">“{q.quote}”</blockquote>
                <figcaption className="mt-4 flex items-center gap-3"><Avatar img={q.photo} name={q.name} size={40} /><span><span className="block text-sm font-medium text-ink">{q.name}</span><span className="block text-xs text-ink-muted">{q.role}</span></span></figcaption>
              </figure>
            ))}
          </div>
        </Section>
      );
    case 'cta': {
      const style = b.style === 'navy' ? 'bg-navy text-white' : b.style === 'light' ? 'bg-primary-soft text-ink' : 'bg-primary text-white';
      return (
        <section className={style}>
          <div className="mx-auto flex max-w-[1200px] flex-col items-start gap-5 px-4 py-14 sm:px-6 md:flex-row md:items-center md:justify-between">
            <div><h2 className="font-heading text-2xl font-semibold sm:text-3xl">{b.heading}</h2>{!!b.text && <p className="mt-2 max-w-2xl opacity-85">{String(b.text)}</p>}</div>
            <Btn href={b.button_url} label={b.button_label} variant={b.style === 'light' ? 'primary' : 'white'} />
          </div>
        </section>
      );
    }
    case 'contact':
      return (
        <Section heading={b.heading || t('site.contact_us', 'Get in touch')} tint={tint}>
          <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
            <div className="space-y-4">
              <p className="text-ink-muted">{String(b.text || t('site.contact_intro', 'Questions about the alumni network, events or giving? Write to the alumni office.'))}</p>
              <ul className="space-y-3 text-sm">
                {!!b.address && <li className="flex items-start gap-3"><MapPin className="mt-0.5 h-5 w-5 text-primary" /><span><span className="block font-medium text-ink">{t('site.address', 'Address')}</span>{String(b.address)}</span></li>}
                {!!b.phone && <li className="flex items-start gap-3"><Phone className="mt-0.5 h-5 w-5 text-primary" /><span><span className="block font-medium text-ink">{t('site.phone', 'Phone')}</span><a href={`tel:${b.phone}`} dir="ltr" className="hover:text-primary">{String(b.phone)}</a></span></li>}
                {!!b.email && <li className="flex items-start gap-3"><Mail className="mt-0.5 h-5 w-5 text-primary" /><span><span className="block font-medium text-ink">{t('site.email', 'Email')}</span><a href={`mailto:${b.email}`} className="hover:text-primary">{String(b.email)}</a></span></li>}
              </ul>
            </div>
            {!!b.show_form && <div className="rounded-card border border-line bg-surface p-6 shadow-card"><ContactForm m={contactMsgs(t)} /></div>}
          </div>
        </Section>
      );
    case 'newsletter':
      return (
        <section className="bg-navy text-white">
          <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 py-12 sm:px-6 md:flex-row md:items-center md:justify-between">
            <div><h2 className="font-heading text-2xl font-semibold">{b.heading || t('site.subscribe_title', 'Stay in touch')}</h2><p className="mt-1 text-white/80">{String(b.text || t('site.subscribe_text', 'News, events and stories from the alumni office — a few times a year.'))}</p></div>
            <NewsletterForm dark m={newsletterMsgs(t)} />
          </div>
        </section>
      );
    default:
      return null;
  }
}

export const contactMsgs = (t: T) => ({
  name: t('site.your_name', 'Your name'), email: t('site.your_email', 'Your email'), phone: t('site.phone_optional', 'Phone (optional)'),
  subject: t('site.subject', 'Subject'), message: t('site.message', 'Message'), send: t('site.send', 'Send message'),
  sent: t('site.sent', 'Thank you — your message has been sent. The alumni office will reply by email.'),
});
export const newsletterMsgs = (t: T) => ({ subscribe: t('site.subscribe', 'Subscribe'), email: t('site.your_email', 'Your email'), done: t('site.subscribe_done', 'Almost done — check your inbox to confirm your subscription.') });


import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CalendarDays, Lock, MapPin, Monitor } from 'lucide-react';
import { apiGet, fmtDate, imgSrc, type EventCard } from '@/lib/api';
import { Shell, Unavailable, context } from '@/components/shell';

type Ev = EventCard & { html: string; past: boolean };
type P = { params: Promise<{ id: string }> };
const valid = (id: string) => /^[0-9a-f-]{36}$/.test(id);

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { id } = await params;
  const e = valid(id) ? await apiGet<Ev>(`/api/v1/public/events/${id}`, 30) : null;
  return e ? { title: e.title, description: e.summary || undefined, openGraph: { images: e.banner ? [imgSrc(e.banner, 1200)!] : undefined } } : {};
}

export default async function EventView({ params }: P) {
  const { id } = await params;
  const ctx = await context();
  if (!ctx) return <Unavailable />;
  const e = valid(id) ? await apiGet<Ev>(`/api/v1/public/events/${id}`, 30) : null;
  if (!e) notFound();
  const { t, lang } = ctx;
  const when = `${fmtDate(e.starts_at, lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${fmtDate(e.starts_at, lang, { hour: 'numeric', minute: '2-digit' })}`;
  return (
    <Shell ctx={ctx}>
      <section className="relative bg-navy text-white">
        {e.banner && <img src={imgSrc(e.banner, 1920)} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />}
        <div className="relative mx-auto max-w-[1200px] px-4 py-14 sm:px-6">
          <a href="/events" className="text-sm text-white/80 hover:text-white">{t('site.events', 'Events')}</a>
          <h1 className="mt-3 font-heading text-3xl font-semibold sm:text-4xl">{e.title}</h1>
          <ul className="mt-4 space-y-1.5 text-white/85">
            <li className="flex items-center gap-2"><CalendarDays className="h-4 w-4" />{when}</li>
            <li className="flex items-center gap-2">{e.is_online ? <><Monitor className="h-4 w-4" />{t('site.online', 'Online')}</> : <><MapPin className="h-4 w-4" />{[e.venue, e.address].filter(Boolean).join(', ')}</>}</li>
          </ul>
        </div>
      </section>
      <section className="mx-auto grid max-w-[1200px] gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_320px]">
        <div>{e.summary && <p className="mb-5 text-lg text-ink-muted">{e.summary}</p>}<div className="prose-site" dangerouslySetInnerHTML={{ __html: e.html }} /></div>
        {!e.past && (
          <aside className="h-fit rounded-card border border-line bg-surface p-5 shadow-card">
            <p className="text-sm text-ink-muted">{e.full ? 'This event is full — join the waitlist in the portal.' : 'Alumni register in the portal and receive a ticket with a QR code.'}</p>
            <a href={`/portal/events/${e.id}`} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-btn bg-primary px-4 py-3 font-medium text-white hover:bg-primary/90"><Lock className="h-4 w-4" />{t('site.register_event', 'Sign in to register')}</a>
          </aside>
        )}
      </section>
    </Shell>
  );
}

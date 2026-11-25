import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CalendarDays } from 'lucide-react';
import { apiGet, type EventCard } from '@/lib/api';
import { EventCardView } from '@/components/blocks';
import { PageTitle, Shell, Unavailable, context } from '@/components/shell';

export const metadata: Metadata = { title: 'Events', description: 'Reunions, seminars and networking events for alumni.' };

export default async function EventsList() {
  const ctx = await context();
  if (!ctx) return <Unavailable />;
  if (ctx.web && !ctx.web.show_events) notFound();
  const { t, lang } = ctx;
  const events = (await apiGet<EventCard[]>('/api/v1/public/events?limit=50', 30)) ?? [];
  return (
    <Shell ctx={ctx}>
      <PageTitle title={t('site.upcoming_events', 'Upcoming events')} intro="Registration and tickets are in the alumni portal." />
      <section className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6">
        {events.length ? <div className="grid gap-4 md:grid-cols-2">{events.map((e) => <EventCardView key={e.id} e={e} t={t} lang={lang} />)}</div>
          : <p className="flex items-center gap-2 text-ink-muted"><CalendarDays className="h-5 w-5" />{t('site.no_events', 'No upcoming events right now.')}</p>}
      </section>
    </Shell>
  );
}

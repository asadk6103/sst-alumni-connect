import type { Metadata } from 'next';
import { apiGet, type Achievement } from '@/lib/api';
import { AchievementCard } from '@/components/blocks';
import { PageTitle, Shell, Unavailable, context } from '@/components/shell';

export const metadata: Metadata = { title: 'Distinguished alumni', description: 'Achievements and success stories of SST alumni.' };

export default async function Distinguished() {
  const ctx = await context();
  if (!ctx) return <Unavailable />;
  const { t } = ctx;
  // Only published achievements whose owners agreed to public display are returned by the API.
  const [distinguished, stories] = await Promise.all([
    apiGet<Achievement[]>('/api/v1/public/achievements?kind=distinguished&limit=50'),
    apiGet<Achievement[]>('/api/v1/public/achievements?limit=50'),
  ]);
  const others = (stories ?? []).filter((a) => a.kind !== 'distinguished');
  return (
    <Shell ctx={ctx}>
      <PageTitle title={t('site.distinguished', 'Distinguished alumni')} intro="SSTians making a difference — shared with their permission." />
      <section className="mx-auto max-w-[1200px] space-y-12 px-4 py-12 sm:px-6">
        {!distinguished?.length && !others.length && <p className="text-ink-muted">Stories will appear here soon.</p>}
        {!!distinguished?.length && <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{distinguished.map((a) => <AchievementCard key={a.id} a={a} />)}</div>}
        {others.length > 0 && <div><h2 className="mb-6 font-heading text-2xl font-semibold text-ink">{t('site.success_stories', 'Success stories')}</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{others.map((a) => <AchievementCard key={a.id} a={a} />)}</div></div>}
      </section>
    </Shell>
  );
}

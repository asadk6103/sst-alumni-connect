import type { Metadata } from 'next';
import { apiPaged, type NewsCard } from '@/lib/api';
import { NewsCardView } from '@/components/blocks';
import { PageTitle, Shell, Unavailable, context } from '@/components/shell';

export const metadata: Metadata = { title: 'News', description: 'News, announcements and success stories from the alumni network.' };
const CATS = ['news', 'announcement', 'success_story'] as const;

export default async function NewsList({ searchParams }: { searchParams: Promise<{ category?: string; page?: string }> }) {
  const sp = await searchParams;
  const ctx = await context();
  if (!ctx) return <Unavailable />;
  const { t, lang } = ctx;
  const cat = CATS.includes(sp.category as (typeof CATS)[number]) ? sp.category! : '';
  const page = Math.max(1, Number(sp.page) || 1);
  const res = await apiPaged<NewsCard>(`/api/v1/public/news?page=${page}&page_size=12${cat ? `&category=${cat}` : ''}`);
  const label: Record<string, string> = { '': 'All', news: t('site.news', 'News'), announcement: 'Announcements', success_story: t('site.success_stories', 'Success stories') };
  const href = (c: string, p = 1) => `/news?${new URLSearchParams({ ...(c ? { category: c } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;
  return (
    <Shell ctx={ctx}>
      <PageTitle title={t('site.news', 'News')}>
        <nav className="mt-6 flex flex-wrap gap-2" aria-label="Categories">
          {['', ...CATS].map((c) => <a key={c} href={href(c)} aria-current={c === cat ? 'page' : undefined} className={`rounded-full px-4 py-1.5 text-sm ${c === cat ? 'bg-white font-medium text-navy' : 'bg-white/10 text-white hover:bg-white/20'}`}>{label[c]}</a>)}
        </nav>
      </PageTitle>
      <section className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6">
        {!res?.data.length ? <p className="text-ink-muted">{t('site.no_news', 'No news yet.')}</p> : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">{res.data.map((n) => <NewsCardView key={n.id} n={n} t={t} lang={lang} />)}</div>
        )}
        {res && res.meta.pages > 1 && (
          <nav className="mt-10 flex items-center justify-center gap-3 text-sm" aria-label="Pages">
            {page > 1 && <a className="rounded-btn border border-line px-4 py-2 hover:bg-canvas" href={href(cat, page - 1)}>←</a>}
            <span className="text-ink-muted">{page} / {res.meta.pages}</span>
            {page < res.meta.pages && <a className="rounded-btn border border-line px-4 py-2 hover:bg-canvas" href={href(cat, page + 1)}>→</a>}
          </nav>
        )}
      </section>
    </Shell>
  );
}

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Newspaper, Pin } from 'lucide-react';
import { api, get, qs, type Paged } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { fmtDate } from '@/lib/utils';
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/display';
import { Tabs } from '@/components/ui/overlay';
import { Pagination } from '@/components/ui/table';

type Img = { url: string } | null;
type Article = { id: string; slug: string; title: string; category: string; summary: string; cover: Img; published_at: string; pinned: boolean; members_only: boolean; html?: string; related?: Article[] };
const CATS: Record<string, string> = { news: 'News', announcement: 'Announcement', success_story: 'Success story' };

function ArticleCard({ a }: { a: Article }) {
  return (
    <Link to={`/portal/news/${a.slug}`} className="group flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card transition-shadow hover:shadow-md">
      {a.cover ? <img src={a.cover.url} alt="" className="aspect-[16/9] w-full object-cover" loading="lazy" /> : <div className="grid aspect-[16/9] place-items-center bg-primary-soft"><Newspaper className="h-8 w-8 text-primary" /></div>}
      <div className="flex flex-1 flex-col p-4">
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">{a.pinned && <Pin className="h-3.5 w-3.5 text-primary" aria-label="Pinned" />}<Badge tone="primary">{CATS[a.category]}</Badge>{a.members_only && <Badge>Members</Badge>}{fmtDate(a.published_at)}</p>
        <p className="mt-2 font-heading font-semibold text-ink group-hover:text-primary">{a.title}</p>
        <p className="mt-1 line-clamp-3 text-sm text-ink-muted">{a.summary}</p>
      </div>
    </Link>
  );
}

export function NewsPage() {
  const t = useT();
  const [cat, setCat] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['news', cat, page], queryFn: () => api<Paged<Article>>(`/api/v1/news${qs({ category: cat || null, page, page_size: 12 })}`) });
  return (
    <>
      <PageHeader title={t('nav.news', 'News')} description="Announcements and stories from the alumni office." />
      <Tabs value={cat} onValueChange={(v) => { setCat(v); setPage(1); }} tabs={[{ value: '', label: 'All' }, ...Object.entries(CATS).map(([v, l]) => ({ value: v, label: l }))]}><span /></Tabs>
      <div className="mt-5">
        {q.isLoading ? <Skeleton className="h-72 rounded-card" /> : !q.data?.data.length ? <Card><EmptyState icon={Newspaper} title="No articles yet" /></Card> : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{q.data.data.map((a) => <ArticleCard key={a.id} a={a} />)}</div>
        )}
        {q.data && q.data.meta.pages > 1 && <Card className="mt-5"><Pagination page={q.data.meta.page} pages={q.data.meta.pages} total={q.data.meta.total} onPage={setPage} /></Card>}
      </div>
    </>
  );
}

export function ArticlePage() {
  const { slug = '' } = useParams();
  const q = useQuery({ queryKey: ['news-article', slug], queryFn: () => get<Article>(`/api/v1/news/${slug}`) });
  const a = q.data;
  if (q.isError) return <Card><EmptyState icon={Newspaper} title="Article not found" /></Card>;
  if (!a) return <Skeleton className="h-96 rounded-card" />;
  return (
    <article className="mx-auto max-w-3xl">
      <PageHeader title={a.title} breadcrumb={<Link to="/portal/news" className="hover:text-ink">News</Link>}
        description={<span className="flex flex-wrap items-center gap-2"><Badge tone="primary">{CATS[a.category]}</Badge>{fmtDate(a.published_at)}</span>} />
      {a.cover && <img src={a.cover.url} alt="" className="mb-6 w-full rounded-card object-cover" />}
      <Card className="p-6">
        {a.summary && <p className="mb-4 text-lg text-ink-muted">{a.summary}</p>}
        <div className="prose-sst" dangerouslySetInnerHTML={{ __html: a.html ?? '' }} />
      </Card>
      {!!a.related?.length && <div className="mt-8"><h2 className="mb-3 font-heading font-semibold text-ink">More like this</h2><div className="grid gap-4 sm:grid-cols-3">{a.related.map((r) => <ArticleCard key={r.id} a={r} />)}</div></div>}
    </article>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { apiGet, fmtDate, imgSrc, type Article } from '@/lib/api';
import { NewsCardView } from '@/components/blocks';
import { Shell, Unavailable, context } from '@/components/shell';

type P = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { slug } = await params;
  const a = await apiGet<Article>(`/api/v1/public/news/${encodeURIComponent(slug)}`);
  if (!a) return {};
  const img = imgSrc(a.cover, 1200);
  return { title: a.seo_title, description: a.seo_description, alternates: { canonical: `/news/${a.slug}` },
    openGraph: { type: 'article', title: a.seo_title, description: a.seo_description, publishedTime: a.published_at, images: img ? [img] : undefined } };
}

export default async function ArticleView({ params }: P) {
  const { slug } = await params;
  const ctx = await context();
  if (!ctx) return <Unavailable />;
  const a = await apiGet<Article>(`/api/v1/public/news/${encodeURIComponent(slug)}`);
  if (!a) notFound();
  const { t, lang } = ctx;
  return (
    <Shell ctx={ctx}>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <a href="/news" className="text-sm font-medium text-primary hover:underline">{t('site.news', 'News')}</a>
        <h1 className="mt-4 font-heading text-3xl font-semibold leading-tight text-ink sm:text-4xl">{a.title}</h1>
        <p className="mt-2 text-sm text-ink-muted"><time dateTime={a.published_at}>{fmtDate(a.published_at, lang, { day: 'numeric', month: 'long', year: 'numeric' })}</time></p>
        {a.cover && <img src={imgSrc(a.cover, 1280)} alt="" className="mt-6 w-full rounded-card object-cover" />}
        {a.summary && <p className="mt-6 text-lg text-ink-muted">{a.summary}</p>}
        <div className="mt-6"><div className="prose-site" dangerouslySetInnerHTML={{ __html: a.html }} /></div>
      </article>
      {a.related.length > 0 && (
        <section className="bg-canvas"><div className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6">
          <h2 className="mb-6 font-heading text-xl font-semibold text-ink">{t('site.latest_news', 'Latest news')}</h2>
          <div className="grid gap-6 md:grid-cols-3">{a.related.map((n) => <NewsCardView key={n.id} n={n} t={t} lang={lang} />)}</div>
        </div></section>
      )}
    </Shell>
  );
}

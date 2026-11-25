import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { apiGet, fmtDate, imgSrc, type Album } from '@/lib/api';
import { PageTitle, Shell, Unavailable, context } from '@/components/shell';

type P = { params: Promise<{ id: string }> };
const valid = (id: string) => /^[0-9a-f-]{36}$/.test(id);

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { id } = await params;
  const a = valid(id) ? await apiGet<Album>(`/api/v1/public/gallery/${id}`) : null;
  return a ? { title: a.title, description: a.description || undefined, openGraph: { images: a.cover ? [imgSrc(a.cover, 1200)!] : undefined } } : {};
}

export default async function AlbumView({ params }: P) {
  const { id } = await params;
  const ctx = await context();
  if (!ctx) return <Unavailable />;
  const a = valid(id) ? await apiGet<Album>(`/api/v1/public/gallery/${id}`) : null;
  if (!a) notFound();
  const { t, lang } = ctx;
  return (
    <Shell ctx={ctx}>
      <PageTitle title={a.title} intro={[a.taken_on && fmtDate(a.taken_on, lang), `${a.photo_count} ${t('site.photos', 'photos')}`].filter(Boolean).join(' · ')} />
      <section className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6">
        {a.description && <p className="mb-8 max-w-3xl text-ink-muted">{a.description}</p>}
        <ul className="columns-1 gap-4 sm:columns-2 lg:columns-3">
          {(a.photos ?? []).map((p) => (
            <li key={p.id} className="mb-4 break-inside-avoid">
              <a href={p.url} target="_blank" rel="noopener noreferrer"><img src={imgSrc(p, 800)} alt={p.caption ?? ''} loading="lazy" className="w-full rounded-card" /></a>
              {p.caption && <p className="mt-1.5 text-sm text-ink-muted">{p.caption}</p>}
            </li>
          ))}
        </ul>
      </section>
    </Shell>
  );
}

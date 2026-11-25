import type { Metadata } from 'next';
import { apiGet, type Album } from '@/lib/api';
import { AlbumCardView } from '@/components/blocks';
import { PageTitle, Shell, Unavailable, context } from '@/components/shell';

export const metadata: Metadata = { title: 'Gallery', description: 'Photos from reunions, events and campus life.' };

export default async function GalleryList() {
  const ctx = await context();
  if (!ctx) return <Unavailable />;
  const { t } = ctx;
  const albums = (await apiGet<Album[]>('/api/v1/public/gallery?limit=50')) ?? [];
  return (
    <Shell ctx={ctx}>
      <PageTitle title={t('site.gallery', 'Gallery')} />
      <section className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6">
        {albums.length ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{albums.map((a) => <AlbumCardView key={a.id} a={a} t={t} />)}</div>
          : <p className="text-ink-muted">{t('site.no_albums', 'No albums yet.')}</p>}
      </section>
    </Shell>
  );
}

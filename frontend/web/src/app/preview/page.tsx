import type { Metadata } from 'next';
import { Eye } from 'lucide-react';
import { apiGet, type CmsPage } from '@/lib/api';
import { Blocks } from '@/components/blocks';
import { Shell, Unavailable, context } from '@/components/shell';

export const metadata: Metadata = { title: 'Preview', robots: { index: false, follow: false } };

/** Draft preview opened from the page editor (short-lived signed link). */
export default async function Preview({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams;
  const ctx = await context();
  if (!ctx) return <Unavailable />;
  const page = token ? await apiGet<CmsPage>(`/api/v1/public/preview?token=${encodeURIComponent(token)}`, 0) : null;
  return (
    <Shell ctx={ctx}>
      <div className="sticky top-0 z-30 flex items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-900"><Eye className="h-4 w-4" />{ctx.t('site.preview_banner', 'Preview — this is how the page will look when published.')}</div>
      {page ? <Blocks blocks={page.blocks} t={ctx.t} lang={ctx.lang} />
        : <p className="mx-auto max-w-xl px-4 py-20 text-center text-ink-muted">This preview link has expired. Open the preview again from the page editor.</p>}
    </Shell>
  );
}

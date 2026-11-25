import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { apiGet, imgSrc, type CmsPage } from '@/lib/api';
import { Blocks } from '@/components/blocks';
import { Shell, Unavailable, context } from '@/components/shell';

type P = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { slug } = await params;
  const page = await apiGet<CmsPage>(`/api/v1/public/pages/${encodeURIComponent(slug)}`);
  if (!page) return {};
  const img = imgSrc(page.featured_image, 1200);
  return { title: page.seo_title, description: page.seo_description || undefined, alternates: { canonical: `/${page.slug}` },
    openGraph: { title: page.seo_title, description: page.seo_description || undefined, images: img ? [img] : undefined } };
}

export default async function CmsPageView({ params }: P) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) notFound();
  const ctx = await context();
  if (!ctx) return <Unavailable />;
  const page = await apiGet<CmsPage>(`/api/v1/public/pages/${slug}`);
  if (!page) notFound();
  return <Shell ctx={ctx}><Blocks blocks={page.blocks} t={ctx.t} lang={ctx.lang} /></Shell>;
}

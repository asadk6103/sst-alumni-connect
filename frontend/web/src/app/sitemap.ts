import type { MetadataRoute } from 'next';
import { apiGet } from '@/lib/api';
import { getSite } from '@/lib/site';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = await getSite();
  const base = site?.app_url ?? 'http://localhost:8080';
  const data = await apiGet<{ pages: { slug: string; updated_at: string }[]; news: { slug: string; updated_at: string }[] }>('/api/v1/public/sitemap', 300);
  const fixed = ['', '/news', '/events', '/gallery', '/distinguished-alumni', '/contact', '/newsletter'].map((p) => ({ url: `${base}${p}` }));
  return [
    ...fixed,
    ...(data?.pages ?? []).map((p) => ({ url: `${base}/${p.slug}`, lastModified: p.updated_at })),
    ...(data?.news ?? []).map((n) => ({ url: `${base}/news/${n.slug}`, lastModified: n.updated_at })),
  ];
}

// Rendered per request: the API is not reachable while the Docker image is built.
export const dynamic = 'force-dynamic';

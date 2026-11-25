import type { MetadataRoute } from 'next';
import { getSite } from '@/lib/site';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const site = await getSite();
  const base = site?.app_url ?? 'http://localhost:8080';
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/portal', '/admin', '/api', '/preview', '/setup'] }], sitemap: `${base}/sitemap.xml` };
}

// Rendered per request: the API is not reachable while the Docker image is built.
export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import '@fontsource-variable/inter/index.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import './globals.css';
import { currentLang, i18n } from '@/lib/api';
import { getSite, pick, themeCss } from '@/lib/site';

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  const icon = pick(site?.assets.favicon ?? site?.assets.institution_logo, 64);
  return {
    title: { default: site?.app_name ?? 'SST Alumni Connect', template: `%s | ${site?.app_name ?? 'SST Alumni Connect'}` },
    description: site?.app_description,
    metadataBase: site?.app_url ? new URL(site.app_url) : undefined,
    icons: icon ? { icon } : undefined,
    openGraph: { siteName: site?.app_name, type: 'website' },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const site = await getSite();
  // Visitor's language (cookie set by the language switch), else the institution default.
  const { lang, rtl } = await i18n(await currentLang(site?.default_language ?? 'en'));
  return (
    <html lang={lang} dir={rtl ? 'rtl' : 'ltr'}>
      <head>{site && <style dangerouslySetInnerHTML={{ __html: themeCss(site) }} />}</head>
      <body>{children}</body>
    </html>
  );
}

export const dynamic = 'force-dynamic';

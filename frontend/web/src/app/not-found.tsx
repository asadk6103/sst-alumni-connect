import { Shell, Unavailable, context } from '@/components/shell';

export default async function NotFound() {
  const ctx = await context();
  if (!ctx) return <Unavailable />;
  const { t } = ctx;
  return (
    <Shell ctx={ctx}>
      <section className="mx-auto max-w-xl px-4 py-24 text-center">
        <p className="font-heading text-6xl font-semibold text-primary">404</p>
        <h1 className="mt-4 font-heading text-2xl font-semibold text-ink">{t('site.not_found', 'Page not found')}</h1>
        <p className="mt-2 text-ink-muted">{t('site.not_found_text', 'The page you are looking for does not exist or is no longer published.')}</p>
        <a href="/" className="mt-6 inline-flex rounded-btn bg-primary px-5 py-3 font-medium text-white hover:bg-primary/90">{t('site.go_home', 'Go to the home page')}</a>
      </section>
    </Shell>
  );
}

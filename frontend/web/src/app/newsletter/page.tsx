import type { Metadata } from 'next';
import { Mail } from 'lucide-react';
import { NewsletterForm } from '@/components/client';
import { newsletterMsgs } from '@/components/blocks';
import { PageTitle, Shell, Unavailable, context } from '@/components/shell';

export const metadata: Metadata = { title: 'Newsletter', description: 'Subscribe to the alumni newsletter.' };

export default async function Newsletter() {
  const ctx = await context();
  if (!ctx) return <Unavailable />;
  const { t } = ctx;
  return (
    <Shell ctx={ctx}>
      <PageTitle title={t('site.newsletter', 'Newsletter')} intro={t('site.subscribe_text', 'News, events and stories from the alumni office — a few times a year.')} />
      <section className="mx-auto max-w-xl px-4 py-14 sm:px-6">
        <div className="rounded-card border border-line bg-surface p-6 shadow-card">
          <Mail className="h-8 w-8 text-primary" />
          <h2 className="mt-3 font-heading text-xl font-semibold text-ink">{t('site.subscribe_title', 'Stay in touch')}</h2>
          <p className="mb-5 mt-1 text-sm text-ink-muted">We send a confirmation email first. Every newsletter has a one-click unsubscribe link.</p>
          <NewsletterForm m={newsletterMsgs(t)} />
        </div>
      </section>
    </Shell>
  );
}

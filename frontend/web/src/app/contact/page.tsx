import type { Metadata } from 'next';
import { Blocks } from '@/components/blocks';
import { PageTitle, Shell, Unavailable, context } from '@/components/shell';

export const metadata: Metadata = { title: 'Contact', description: 'Contact the alumni office.' };

export default async function Contact() {
  const ctx = await context();
  if (!ctx) return <Unavailable />;
  const { t, lang, web, site } = ctx;
  const c = web?.contact ?? { email: site.contact_email, phone: site.contact_phone, address: site.address };
  return (
    <Shell ctx={ctx}>
      <PageTitle title={t('site.contact_us', 'Get in touch')} />
      <Blocks t={t} lang={lang} blocks={[{ id: 'contact', type: 'contact', heading: '', text: '', ...c, show_form: web?.contact_form ?? true }]} />
    </Shell>
  );
}

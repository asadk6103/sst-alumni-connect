// Redesign phase 5: Resource hub (browse, featured, download, save, collections, upload + staff review) and Messages (tabs, star, day separators, emoji).
//   node scripts/e2e-redesign-5.mjs <appBase> <adminEmail> <adminPassword> <outDir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [base, adminEmail, adminPassword, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const stamp = Date.now().toString(36);
const PW = 'Str0ngPassword!';
const ok = (m) => console.log('✓', m);
async function call(path, { token, method = 'GET', body, form } = {}) {
  const r = await fetch(`${base}${path}`, { method, headers: { ...(form ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
  return j.data;
}
const admin = (await call('/api/v1/auth/login', { method: 'POST', body: { email: adminEmail, password: adminPassword } })).access_token;
const security = await call('/api/v1/admin/config/settings/security', { token: admin });
await call('/api/v1/admin/config/settings/security', { token: admin, method: 'PUT', body: { ...security, require_email_verification: false } });
async function member(name, year) {
  const email = `${name.toLowerCase()}-${stamp}@example.org`;
  await call('/api/v1/auth/register', { method: 'POST', body: { full_name: `${name} ${stamp}`, email, phone: '+923001234567', password: PW, accept_terms: true, graduation_year: year, admission_year: year - 10, city: 'Lahore', country: 'Pakistan' } });
  const row = (await fetch(`${base}/api/v1/admin/alumni?q=${encodeURIComponent(email)}`, { headers: { authorization: `Bearer ${admin}` } }).then((r) => r.json())).data[0];
  await call(`/api/v1/admin/verification/${row.id}/approve`, { token: admin, method: 'POST', body: {} });
  const token = (await call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW } })).access_token;
  return { email, id: row.id, token, name: `${name} ${stamp}` };
}
const a = await member('Rabia', 2013);
const b = await member('Saad', 2013);
await call('/api/v1/admin/config/settings/security', { token: admin, method: 'PUT', body: security });
await call('/api/v1/alumni/connections', { token: b.token, method: 'POST', body: { user_id: a.id } });
const req = (await call('/api/v1/alumni/connections?type=received', { token: a.token }))[0];
await call(`/api/v1/alumni/connections/${req.request_id}/accept`, { token: a.token, method: 'POST' });
const pdf = () => { const fd = new FormData(); fd.append('file', new Blob([Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')], { type: 'application/pdf' }), 'guide.pdf'); return fd; };
const up = await call('/api/v1/resources/uploads', { token: admin, method: 'POST', form: pdf() });
const res = await call('/api/v1/resources', { token: admin, method: 'POST', body: { title: `Interview Handbook ${stamp}`, category: 'career', media_id: up.id, description: 'Questions and answers from alumni recruiters.' } });
await call(`/api/v1/admin/resources/${res.id}/feature`, { token: admin, method: 'POST', body: { featured: true } });
const col = await call('/api/v1/admin/resources/collections', { token: admin, method: 'POST', body: { title: `Career Pack ${stamp}`, subtitle: 'Start here', icon: 'briefcase', resource_ids: [res.id] } });
const conv = await call('/api/v1/messages/conversations/direct', { token: b.token, method: 'POST', body: { user_id: a.id } });
await call(`/api/v1/messages/conversations/${conv.id}/messages`, { token: b.token, method: 'POST', body: { body: 'Salam! Coming to the reunion?' } });
ok('seeded members, a featured resource in a collection and an unread chat');

const browser = await chromium.launch();
const errors = [];
const pages = [];
async function signIn(email, password = PW, viewport = { width: 1536, height: 1000 }, landing = /\/portal$/) {
  const p = await (await browser.newContext({ viewport })).newPage();
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  pages.push(p);
  await p.goto(`${base}/`);
  await p.getByLabel('Email Address').fill(email);
  await p.getByPlaceholder('Enter your password').fill(password);
  await p.getByRole('button', { name: 'Sign In' }).click();
  await p.waitForURL(landing);
  return p;
}
const shot = (p, n) => p.screenshot({ path: `${out}/${n}.png` });
const fail = async (e) => { for (const [i, p] of pages.entries()) await p.screenshot({ path: `${out}/FAILED-${i}.png`, fullPage: true }).catch(() => {}); console.log('FAILED:', e.message.split('\n')[0]); console.log(errors.join('\n')); process.exit(1); };
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);

const p = await signIn(a.email);
await p.goto(`${base}/portal/resources`);
await p.getByRole('heading', { name: 'Alumni Resource Hub' }).waitFor();
await p.getByRole('heading', { name: 'Featured Resources' }).waitFor();
const row = p.locator('div.rounded-card', { hasText: `Interview Handbook ${stamp}` }).first();
await row.getByRole('button', { name: 'Save resource' }).click();
await p.getByText('Saved.').waitFor();
const [popup] = await Promise.all([p.waitForEvent('popup').catch(() => null), row.getByRole('button', { name: 'Download' }).click()]);
if (popup) await popup.close();
await p.getByRole('button', { name: /My Downloads/ }).getByText('1').waitFor();
await shot(p, '01-resources');
ok('resource hub: featured, save, download counted');
await p.getByRole('button', { name: new RegExp(`Career Pack ${stamp}`) }).click();
await p.getByRole('heading', { name: `Career Pack ${stamp}` }).waitFor();
ok('curated collection opens');

await p.goto(`${base}/portal/resources?upload=1`);
const chooser = p.waitForEvent('filechooser');
await p.getByRole('button', { name: /Choose a file/ }).click();
await (await chooser).setFiles({ name: 'scholarship-tips.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n') });
await p.getByRole('dialog').getByText('scholarship-tips.pdf').waitFor();
await p.getByLabel('Title').fill(`Scholarship tips ${stamp}`);
await p.getByLabel('Category').selectOption('scholarships');
await p.getByRole('button', { name: 'Submit' }).click();
await p.getByText('Thanks! The alumni office will review it before it is listed.').waitFor();
await p.getByRole('button', { name: /My Uploads/ }).click();
await p.getByText('Waiting for review').first().waitFor();
ok('member upload goes to review');

const ad = await signIn(adminEmail, adminPassword, { width: 1536, height: 1000 }, /\/(admin|portal)/);
await ad.goto(`${base}/admin/resources`);
const pending = ad.locator('li', { hasText: `Scholarship tips ${stamp}` });
await pending.getByRole('button', { name: 'Approve' }).click();
await ad.getByText('Saved — the member was notified.').waitFor();
await shot(ad, '02-admin-resources');
ok('staff approved the upload');

await p.goto(`${base}/portal/messages`);
await p.getByRole('tab', { name: /Unread \(1\)/ }).click();
await p.getByRole('link', { name: new RegExp(b.name) }).click();
await p.getByText('Salam! Coming to the reunion?').waitFor();
await p.getByText('Today', { exact: true }).waitFor();
await p.getByRole('button', { name: 'Conversation options' }).click();
await p.getByRole('menuitem', { name: 'Star' }).click();
await p.getByRole('tab', { name: 'Starred' }).click();
await p.getByRole('link', { name: new RegExp(b.name) }).waitFor();
await p.getByRole('textbox', { name: 'Message', exact: true }).fill('Yes, see you there ');
await p.getByRole('button', { name: 'Emoji' }).click();
await p.getByRole('menu').getByRole('button', { name: '🎉' }).click();
await p.getByRole('button', { name: 'Send' }).click();
await p.getByText('Yes, see you there 🎉').waitFor();
await shot(p, '03-messages');
ok('messages: unread tab, day separator, star, emoji send');

const m = await signIn(a.email, PW, { width: 390, height: 844 });
for (const path of ['/portal/resources', `/portal/resources?collection=${col.id}`, '/portal/messages', `/portal/messages/${conv.id}`]) {
  await m.goto(`${base}${path}`);
  await m.waitForLoadState('networkidle');
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) throw new Error(`${path} overflows by ${overflow}px on mobile`);
}
await shot(m, '04-chat-mobile');
ok('no horizontal overflow at 390px');
await browser.close();
if (errors.length) { console.log('Errors:\n' + errors.join('\n')); process.exit(1); }
console.log('No page errors.');

// Browser walk-through of Stage 5: page builder + preview + publish, menus, news, contact inbox, custom fields,
// Urdu / right-to-left, reports with export.
//   node scripts/e2e-stage5.mjs <appBase> <adminEmail> <adminPassword> <outDir> <websiteBase>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [base, adminEmail, adminPassword, out, site] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const stamp = Date.now().toString(36);
const PW = 'Str0ngPassword!';
const ok = (m) => console.log('✓', m);

async function call(path, { token, method = 'GET', body } = {}) {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
  return j.data;
}
const admin = (await call('/api/v1/auth/login', { method: 'POST', body: { email: adminEmail, password: adminPassword } })).access_token;
const security = await call('/api/v1/admin/config/settings/security', { token: admin });
await call('/api/v1/admin/config/settings/security', { token: admin, method: 'PUT', body: { ...security, require_email_verification: false } });
const email = `cms-${stamp}@example.org`;
await call('/api/v1/auth/register', { method: 'POST', body: { full_name: `Mehwish ${stamp}`, email, phone: '+923001234567', password: PW, accept_terms: true,
  graduation_year: 2014, admission_year: 2004, city: 'Lahore', country: 'Pakistan' } });
const row = (await fetch(`${base}/api/v1/admin/alumni?q=${encodeURIComponent(email)}`, { headers: { authorization: `Bearer ${admin}` } }).then((r) => r.json())).data[0];
await call(`/api/v1/admin/verification/${row.id}/approve`, { token: admin, method: 'POST', body: {} });
let fieldId = null;
const cleanup = async () => {
  await call('/api/v1/admin/config/settings/security', { token: admin, method: 'PUT', body: security }).catch(() => {});
  if (fieldId) {
    const f = (await call('/api/v1/admin/custom-fields?entity=alumni_profile', { token: admin })).find((x) => x.id === fieldId);
    if (f) await call(`/api/v1/admin/custom-fields/${fieldId}`, { token: admin, method: 'PUT', body: { ...f, required: false, active: false } }).catch(() => {});
  }
};
ok('seeded a verified member');

const browser = await chromium.launch();
const errors = [];
const pages = [];
function watch(page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('response', async (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()} ${(await r.text().catch(() => '')).slice(0, 200)}`); });
  pages.push(page);
  return page;
}
async function signIn(user, password = PW, viewport = { width: 1440, height: 900 }) {
  const page = watch(await (await browser.newContext({ viewport, acceptDownloads: true })).newPage());
  await page.goto(`${base}/login`);
  await page.getByLabel('Email address').fill(user);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(portal|admin)$/);
  return page;
}
const shot = (p, n) => p.screenshot({ path: `${out}/${n}.png`, fullPage: true });
const fail = async (e) => {
  for (const [i, p] of pages.entries()) await p.screenshot({ path: `${out}/FAILED-${i}.png`, fullPage: true }).catch(() => {});
  console.log('FAILED:', e.message.split('\n')[0]);
  console.log(errors.join('\n'));
  await cleanup();
  process.exit(1);
};
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);

// ── page builder ────────────────────────────────────────────────────────────
const adm = await signIn(adminEmail, adminPassword);
await adm.goto(`${base}/admin/pages`);
await adm.getByRole('button', { name: 'New page' }).click();
const title = `Reunion ${stamp}`;
await adm.getByRole('dialog').getByLabel('Title').fill(title);
await adm.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
await adm.waitForURL(/\/admin\/pages\/[0-9a-f-]{36}$/);
await adm.getByRole('button', { name: 'Add a block' }).click();
await adm.getByRole('dialog').getByRole('button', { name: /^Rich text/ }).click();
await adm.getByLabel('Text', { exact: true }).fill('## Programme\n\n- Dinner at **7 pm**\n- Campus tour\n\n<script>alert(1)</script>');
await adm.getByRole('button', { name: 'Add a block' }).click();
await adm.getByRole('dialog').getByRole('button', { name: /^Statistics/ }).click();
await adm.getByRole('button', { name: 'Save draft' }).click();
await adm.getByText('Draft saved.').waitFor();
await shot(adm, '01-page-editor');
ok('page created with hero, rich text and statistics blocks');

await adm.getByRole('button', { name: 'Preview' }).click();
const frame = adm.frameLocator('iframe[title="Page preview"]');
await frame.getByRole('heading', { name: 'Programme' }).waitFor({ timeout: 60000 });
if (await frame.locator('script:has-text("alert(1)")').count()) throw new Error('script tag rendered in preview');
await adm.getByRole('button', { name: 'Mobile' }).click();
await adm.waitForTimeout(400);
await shot(adm, '02-preview-mobile');
await adm.getByRole('button', { name: 'Close preview' }).click();
ok('draft preview renders on the website (desktop and mobile), script escaped');

const slug = `reunion-${stamp}`;
let r = await fetch(`${site}/${slug}`);
if (r.status !== 404) throw new Error(`draft should not be public, got ${r.status}`);
await adm.getByRole('button', { name: 'Publish', exact: true }).click();
await adm.getByText('Page published.').waitFor();
r = await fetch(`${site}/${slug}`);
if (r.status !== 200 || !(await r.text()).includes('Programme')) throw new Error('published page missing on the website');
ok('published page is live on the website');

// ── menu ────────────────────────────────────────────────────────────────────
await adm.goto(`${base}/admin/navigation`);
await adm.getByRole('button', { name: 'Add link' }).click();
const last = adm.locator('div.rounded-card.border.border-line.bg-surface.p-3').last();
await last.getByLabel('Label').fill(`Reunion ${stamp}`);
await last.getByLabel('Links to').selectOption('page');
await last.getByLabel('Target').selectOption(slug);
await adm.getByRole('button', { name: 'Save menu' }).click();
await adm.getByText('Menu saved.').waitFor();
const home = watch(await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage());
// the website caches API data for up to 15 s
const menuLink = home.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: `Reunion ${stamp}` });
for (let i = 0; i < 12; i++) { await home.goto(`${site}/`); if (await menuLink.count()) break; await home.waitForTimeout(2500); }
await menuLink.click();
await home.getByRole('heading', { name: 'Programme' }).waitFor();
await shot(home, '03-website-page');
ok('menu link added and followed on the website');

// ── news ────────────────────────────────────────────────────────────────────
await adm.goto(`${base}/admin/news`);
await adm.getByRole('button', { name: 'Write an article' }).click();
const dlg = adm.getByRole('dialog');
await dlg.getByLabel(/^Title/).fill(`Scholarship results ${stamp}`);
await dlg.getByLabel('Summary').fill('Twelve students receive alumni scholarships.');
await dlg.getByLabel('Article').fill('## Recipients\n\nCongratulations to all recipients.');
await dlg.getByRole('button', { name: 'Publish' }).click();
await adm.getByText('Article published.').waitFor();
const newsLink = home.getByRole('link', { name: new RegExp(`Scholarship results ${stamp}`) });
for (let i = 0; i < 12; i++) { await home.goto(`${site}/news`); if (await newsLink.count()) break; await home.waitForTimeout(2500); }
await newsLink.click();
await home.getByRole('heading', { name: 'Recipients' }).waitFor();
ok('news article published and readable on the website');

// ── contact form → inbox ────────────────────────────────────────────────────
await home.goto(`${site}/contact`);
await home.getByLabel('Your name').fill('Website Visitor');
await home.getByLabel('Your email').fill('visitor@example.org');
await home.getByLabel('Subject').fill(`Question ${stamp}`);
await home.getByLabel('Message').fill('When is the next reunion dinner?');
await home.getByRole('button', { name: 'Send message' }).click();
await home.getByText(/your message has been sent/).waitFor();
await adm.goto(`${base}/admin/website/messages`);
await adm.getByText(`Question ${stamp}`).click();
await adm.getByText('When is the next reunion dinner?').waitFor();
ok('contact message arrives in the website inbox');

// ── custom field ────────────────────────────────────────────────────────────
await adm.goto(`${base}/admin/custom-fields`);
await adm.getByRole('button', { name: 'Add field' }).click();
const fd = adm.getByRole('dialog');
await fd.getByRole('textbox', { name: /^Label/ }).first().fill(`T-shirt size ${stamp}`);
await fd.getByLabel('Type').selectOption('select');
await fd.getByRole('button', { name: 'Add option' }).click();
await fd.getByLabel('Option label').nth(0).fill('Medium');
await fd.getByRole('button', { name: 'Add option' }).click();
await fd.getByLabel('Option label').nth(1).fill('Large');
await fd.getByRole('button', { name: 'Save' }).click();
await adm.getByText('Field saved.').waitFor();
fieldId = (await call('/api/v1/admin/custom-fields?entity=alumni_profile', { token: admin })).find((x) => x.key === `t_shirt_size_${stamp}`)?.id;
await shot(adm, '04-custom-fields');

const m = await signIn(email);
await m.goto(`${base}/portal/profile/more`);
await m.getByLabel(`T-shirt size ${stamp}`).selectOption('large');
await m.getByRole('button', { name: 'Save' }).click();
await m.getByText('Profile saved.').waitFor();
const me = await (await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) })).json();
const prof = await call('/api/v1/alumni/me', { token: me.data.access_token });
if (prof.custom_fields[`t_shirt_size_${stamp}`] !== 'large') throw new Error('custom field not saved');
ok('custom field added by the admin and answered by a member');

// ── Urdu / RTL ──────────────────────────────────────────────────────────────
await m.goto(`${base}/portal`);
await m.locator('header select').selectOption('ur');
await m.waitForFunction(() => document.documentElement.dir === 'rtl');
await m.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: 'ڈائریکٹری' }).waitFor();
await shot(m, '05-portal-urdu');
await m.locator('header select').selectOption('en');
await m.waitForFunction(() => document.documentElement.dir === 'ltr');
ok('member switches to Urdu (right-to-left) and back');

// ── reports ─────────────────────────────────────────────────────────────────
await adm.goto(`${base}/admin/reports/registrations`);
await adm.getByRole('img', { name: 'Line chart' }).waitFor();
await adm.getByRole('button', { name: 'Since the beginning' }).click();
const [dl] = await Promise.all([adm.waitForEvent('download'), adm.getByRole('button', { name: 'Excel' }).click()]);
if (!dl.suggestedFilename().endsWith('.xlsx')) throw new Error(`unexpected download ${dl.suggestedFilename()}`);
const [pdf] = await Promise.all([adm.waitForEvent('download'), adm.getByRole('button', { name: 'PDF' }).click()]);
if (!pdf.suggestedFilename().endsWith('.pdf')) throw new Error(`unexpected download ${pdf.suggestedFilename()}`);
await shot(adm, '06-report');
await adm.goto(`${base}/admin/reports/verification`);
await adm.getByText('Members by verification status.').waitFor();
ok('reports render with charts; Excel and PDF exports download');

// ── mobile ──────────────────────────────────────────────────────────────────
const mob = watch(await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage());
for (const url of [`${site}/`, `${site}/${slug}`, `${site}/news`, `${site}/contact`, `${site}/about`]) {
  await mob.goto(url);
  await mob.waitForLoadState('networkidle');
  const overflow = await mob.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) throw new Error(`${url} overflows by ${overflow}px on mobile`);
}
await shot(mob, '07-website-mobile');
const madm = await signIn(adminEmail, adminPassword, { width: 390, height: 844 });
for (const path of ['/admin/pages', '/admin/news', '/admin/reports/registrations', '/admin/custom-fields']) {
  await madm.goto(`${base}${path}`);
  await madm.waitForLoadState('networkidle');
  const overflow = await madm.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) throw new Error(`${path} overflows by ${overflow}px on mobile`);
}
ok('no horizontal overflow at 390px (website and admin)');

await cleanup();
await browser.close();
if (errors.length) { console.log('Errors:\n' + errors.join('\n')); process.exit(1); }
console.log('No page errors.');

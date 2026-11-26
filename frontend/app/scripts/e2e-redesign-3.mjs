// Redesign phase 3: Communities list (create, categories, invitations) and community detail (documents, events, invites, follow level).
//   node scripts/e2e-redesign-3.mjs <appBase> <adminEmail> <adminPassword> <outDir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [base, adminEmail, adminPassword, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const stamp = Date.now().toString(36);
const PW = 'Str0ngPassword!';
const ok = (m) => console.log('✓', m);
async function call(path, { token, method = 'GET', body } = {}) {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
  return j.data;
}
const admin = (await call('/api/v1/auth/login', { method: 'POST', body: { email: adminEmail, password: adminPassword } })).access_token;
const security = await call('/api/v1/admin/config/settings/security', { token: admin });
await call('/api/v1/admin/config/settings/security', { token: admin, method: 'PUT', body: { ...security, require_email_verification: false } });
async function member(name, year) {
  const email = `${name.toLowerCase()}-${stamp}@example.org`;
  await call('/api/v1/auth/register', { method: 'POST', body: { full_name: `${name} ${stamp}`, email, phone: '+923001234567', password: PW, accept_terms: true,
    graduation_year: year, admission_year: year - 10, city: 'Lahore', country: 'Pakistan' } });
  const row = (await fetch(`${base}/api/v1/admin/alumni?q=${encodeURIComponent(email)}`, { headers: { authorization: `Bearer ${admin}` } }).then((r) => r.json())).data[0];
  await call(`/api/v1/admin/verification/${row.id}/approve`, { token: admin, method: 'POST', body: {} });
  const token = (await call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW } })).access_token;
  return { email, id: row.id, token, name: `${name} ${stamp}` };
}
const a = await member('Amna', 2015);
const b = await member('Babar', 2015);
await call('/api/v1/alumni/connections', { token: a.token, method: 'POST', body: { user_id: b.id } });
const req = (await call('/api/v1/alumni/connections?type=received', { token: b.token }))[0];
await call(`/api/v1/alumni/connections/${req.request_id}/accept`, { token: b.token, method: 'POST' });
await call('/api/v1/admin/config/settings/security', { token: admin, method: 'PUT', body: security });
ok('seeded two connected members');

const browser = await chromium.launch();
const errors = [];
const pages = [];
async function signIn(email, viewport = { width: 1536, height: 1000 }) {
  const p = await (await browser.newContext({ viewport })).newPage();
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  pages.push(p);
  await p.goto(`${base}/`);
  await p.getByLabel('Email Address').fill(email);
  await p.getByPlaceholder('Enter your password').fill(PW);
  await p.getByRole('button', { name: 'Sign In' }).click();
  await p.waitForURL(/\/portal$/);
  return p;
}
const shot = (p, n, full = false) => p.screenshot({ path: `${out}/${n}.png`, fullPage: full });
const fail = async (e) => { for (const [i, p] of pages.entries()) await p.screenshot({ path: `${out}/FAILED-${i}.png`, fullPage: true }).catch(() => {}); console.log('FAILED:', e.message.split('\n')[0]); console.log(errors.join('\n')); process.exit(1); };
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);

const p = await signIn(a.email);
await p.goto(`${base}/portal/community`);
await p.waitForURL(/\/portal\/community\/groups$/);
await p.getByRole('heading', { name: 'Alumni Communities' }).waitFor();
await shot(p, '01-communities');
await p.getByRole('button', { name: 'Create Community', exact: true }).click();
const name = `Data Science Circle ${stamp}`;
await p.getByLabel('Name').fill(name);
await p.getByLabel('Description').fill('Analytics, ML and data careers for SST alumni.');
await p.getByLabel('Category').selectOption('professional');
await p.getByLabel('Privacy').selectOption('approval');
await p.getByRole('dialog').getByRole('button', { name: 'Create Community' }).click();
await p.waitForURL(/\/portal\/community\/groups\/[0-9a-f-]{36}$/);
const gid = p.url().split('/').pop();
await p.getByText('This community is waiting for approval').waitFor();
await call(`/api/v1/admin/community/groups/${gid}/decide`, { token: admin, method: 'POST', body: { action: 'approve' } });
await p.reload();
await p.getByText('Private Community · 1 member').waitFor();
ok('community created (private, professional) and approved');

// document post
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const chooser = p.waitForEvent('filechooser');
await p.getByRole('button', { name: 'Document' }).click();
await (await chooser).setFiles({ name: 'syllabus.pdf', mimeType: 'application/pdf', buffer: pdf });
await p.getByRole('dialog').getByText('syllabus.pdf').waitFor();
await p.getByLabel('Post text').fill('Course outline for the study group');
await p.getByRole('dialog').getByRole('button', { name: 'Post', exact: true }).click();
await p.getByRole('link', { name: /syllabus\.pdf/ }).first().waitFor();
await p.getByRole('tab', { name: 'Files' }).click();
await p.getByText('syllabus.pdf').waitFor();
ok('document shared in a post and listed under Files');

// community event
await p.getByRole('tab', { name: 'Discussion' }).click();
await p.getByRole('button', { name: 'Event' }).click();
const d = new Date(Date.now() + 7 * 86400000);
const local = (x) => new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
await p.getByLabel('Event title').fill('Kaggle night');
await p.getByLabel('Starts').fill(local(d));
await p.getByLabel('Ends').fill(local(new Date(d.getTime() + 2 * 3600000)));
await p.getByLabel('Venue').fill('Campus lab');
await p.getByRole('button', { name: 'Create Event' }).click();
await p.getByText('Event created.').waitFor();
await p.getByRole('link', { name: 'Kaggle night' }).first().waitFor();
ok('community event created, listed under Events and in Upcoming Events');

// invite + follow level
await p.getByRole('button', { name: 'Invite Members' }).click();
await p.getByLabel(`Invite ${b.name}`).check();
await p.getByRole('button', { name: /Send Invites \(1\)/ }).click();
await p.getByText('1 invitation sent.').waitFor();
await p.getByRole('button', { name: /Following/ }).click();
await p.getByRole('menuitem', { name: /Highlights only/ }).click();
await p.getByRole('button', { name: /Highlights/ }).waitFor();
await p.getByRole('tab', { name: 'Discussion' }).click();
await shot(p, '02-community-detail');
ok('invited a connection; follow level set to highlights');

const q = await signIn(b.email);
await q.goto(`${base}/portal/community/groups?tab=invites`);
await q.getByText(name).waitFor();
await q.getByRole('button', { name: 'Accept' }).click();
await q.goto(`${base}/portal/community/groups/${gid}`);
await q.getByRole('button', { name: /Following/ }).waitFor();
await q.getByText('Course outline for the study group').waitFor();
ok('invitee accepted and can read the private community');
await q.goto(`${base}/portal/community/groups`);
await q.getByRole('button', { name: 'Professional' }).click();
await q.getByRole('link', { name }).first().waitFor();
await q.getByText('Course outline for the study group').waitFor(); // trending discussions
await shot(q, '03-communities-filtered');
ok('category filter and trending discussions');

const m = await signIn(a.email, { width: 390, height: 844 });
for (const path of ['/portal/community/groups', `/portal/community/groups/${gid}`, `/portal/community/groups/${gid}?tab=files`]) {
  await m.goto(`${base}${path}`);
  await m.waitForLoadState('networkidle');
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) throw new Error(`${path} overflows by ${overflow}px on mobile`);
}
await m.goto(`${base}/portal/community/groups/${gid}`);
await m.waitForLoadState('networkidle');
await shot(m, '04-detail-mobile');
ok('no horizontal overflow at 390px');

await browser.close();
if (errors.length) { console.log('Errors:\n' + errors.join('\n')); process.exit(1); }
console.log('No page errors.');

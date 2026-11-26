// Redesign phase 2: My Network (tabs, requests), Find Alumni (tabs, filters, grid), Directory (filters), Profile (own + other).
//   node scripts/e2e-redesign-2.mjs <appBase> <adminEmail> <adminPassword> <outDir>
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
async function member(name, year, city) {
  const email = `${name.toLowerCase().replace(/\s/g, '')}-${stamp}@example.org`;
  await call('/api/v1/auth/register', { method: 'POST', body: { full_name: `${name} ${stamp}`, email, phone: '+923001234567', password: PW, accept_terms: true,
    graduation_year: year, admission_year: year - 10, city, country: 'Pakistan', designation: 'Engineer', organization: 'Acme' } });
  const row = (await fetch(`${base}/api/v1/admin/alumni?q=${encodeURIComponent(email)}`, { headers: { authorization: `Bearer ${admin}` } }).then((r) => r.json())).data[0];
  await call(`/api/v1/admin/verification/${row.id}/approve`, { token: admin, method: 'POST', body: {} });
  const token = (await call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW } })).access_token;
  return { email, id: row.id, token, name: `${name} ${stamp}` };
}
const a = await member('Areeba', 2014, 'Lahore');
const b = await member('Bashir', 2014, 'Lahore');
const c = await member('Cyra', 2014, 'Karachi');
await call('/api/v1/alumni/connections', { token: b.token, method: 'POST', body: { user_id: a.id } }); // B → A (pending for A)
await call('/api/v1/alumni/connections', { token: c.token, method: 'POST', body: { user_id: b.id } });
const req = (await call('/api/v1/alumni/connections?type=received', { token: b.token }))[0];
await call(`/api/v1/alumni/connections/${req.request_id}/accept`, { token: b.token, method: 'POST' }); // B–C connected
await call('/api/v1/admin/config/settings/security', { token: admin, method: 'PUT', body: security });
ok('seeded three members with requests and connections');

const browser = await chromium.launch();
const errors = [];
const pages = [];
async function signIn(email, password = PW, viewport = { width: 1536, height: 1000 }) {
  const p = await (await browser.newContext({ viewport })).newPage();
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  pages.push(p);
  await p.goto(`${base}/`);
  await p.getByLabel('Email Address').fill(email);
  await p.getByPlaceholder('Enter your password').fill(password);
  await p.getByRole('button', { name: 'Sign In' }).click();
  await p.waitForURL(/\/portal$/);
  return p;
}
const shot = (p, n) => p.screenshot({ path: `${out}/${n}.png` });
const fail = async (e) => { for (const [i, p] of pages.entries()) await p.screenshot({ path: `${out}/FAILED-${i}.png`, fullPage: true }).catch(() => {}); console.log('FAILED:', e.message.split('\n')[0]); console.log(errors.join('\n')); process.exit(1); };
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);

const p = await signIn(a.email);
await p.goto(`${base}/portal/network`);
await p.getByRole('heading', { name: 'My Network' }).waitFor();
await p.getByText(b.name).first().waitFor();
await shot(p, '01-my-network');
await p.locator('div.rounded-card', { hasText: b.name }).getByRole('button', { name: 'Accept' }).first().click();
await p.getByText('You are now connected.').waitFor();
ok('request accepted from My Network');
await p.getByRole('tab', { name: /Connections/ }).click();
await p.getByText(b.name).first().waitFor();
ok('connections tab lists the new connection');

await p.goto(`${base}/portal/network/find`);
await p.getByRole('heading', { name: 'Find Alumni' }).waitFor();
await p.getByRole('tab', { name: /Same Batch/ }).click();
await p.getByText(c.name).first().waitFor();
const row = p.locator('div.grid', { hasText: c.name }).first();
await row.getByText('1 mutual').waitFor();
await shot(p, '02-find-alumni');
await p.getByRole('button', { name: 'Grid view' }).click();
await p.getByRole('button', { name: 'View Profile' }).first().waitFor();
await shot(p, '03-find-grid');
ok('find alumni: same-batch tab, mutual connections, grid view');

await p.goto(`${base}/portal/directory`);
await p.getByRole('heading', { name: 'Alumni Directory' }).waitFor();
await p.getByLabel('Search the directory').fill(stamp);
await p.getByText(c.name).waitFor();
await p.getByRole('button', { name: 'Location' }).click();
await p.getByLabel('Search city…').fill('Karachi');
await p.locator('label', { hasText: 'Karachi' }).locator('input').check();
await p.getByRole('button', { name: /Apply Filters/ }).click();
await p.waitForTimeout(800);
if (await p.getByText(b.name).count()) throw new Error('city filter did not apply');
await shot(p, '04-directory');
ok('directory search and city filter');

await p.goto(`${base}/portal/alumni/${c.id}`);
await p.getByRole('heading', { name: c.name }).waitFor();
await p.getByRole('tab', { name: 'Activity' }).click();
await p.getByRole('tab', { name: 'Overview' }).click();
await shot(p, '05-other-profile');
ok('other member profile with tabs');

// own profile + cover upload
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
await p.goto(`${base}/portal/profile`);
await p.getByRole('heading', { name: 'Profile Completion' }).waitFor();
await p.locator('input[type=file]').first().setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: png });
await p.getByText('Cover updated.').waitFor();
await shot(p, '06-my-profile');
await p.getByRole('button', { name: 'Edit Profile' }).click();
await p.waitForURL(/\/portal\/profile\/edit\/personal$/);
ok('own profile: completion card, cover upload, edit link');

const m = await signIn(a.email, PW, { width: 390, height: 844 });
for (const path of ['/portal/network', '/portal/network/find', '/portal/directory', '/portal/profile', `/portal/alumni/${c.id}`]) {
  await m.goto(`${base}${path}`);
  await m.waitForLoadState('networkidle');
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) throw new Error(`${path} overflows by ${overflow}px on mobile`);
}
await shot(m, '07-profile-mobile');
ok('no horizontal overflow at 390px');

await browser.close();
if (errors.length) { console.log('Errors:\n' + errors.join('\n')); process.exit(1); }
console.log('No page errors.');

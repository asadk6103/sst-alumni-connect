// Redesign phase 4c: Mentorship (find a mentor by category, request, mentee listing, requests tab, find a mentee, sessions).
//   node scripts/e2e-redesign-4c.mjs <appBase> <adminEmail> <adminPassword> <outDir>
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
  await call('/api/v1/auth/register', { method: 'POST', body: { full_name: `${name} ${stamp}`, email, phone: '+923001234567', password: PW, accept_terms: true, graduation_year: year, admission_year: year - 10, city: 'Lahore', country: 'Pakistan' } });
  const row = (await fetch(`${base}/api/v1/admin/alumni?q=${encodeURIComponent(email)}`, { headers: { authorization: `Bearer ${admin}` } }).then((r) => r.json())).data[0];
  await call(`/api/v1/admin/verification/${row.id}/approve`, { token: admin, method: 'POST', body: {} });
  const token = (await call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW } })).access_token;
  return { email, id: row.id, token, name: `${name} ${stamp}` };
}
const mentor = await member('Mehreen', 2003);
const mentee = await member('Ahsan', 2019);
await call('/api/v1/admin/config/settings/security', { token: admin, method: 'PUT', body: security });
await call('/api/v1/mentorship/me', { token: mentor.token, method: 'PUT', body: { industry: 'Technology', expertise: ['Product', 'Leadership', 'Hiring', 'Startups'], formats: ['video'], max_mentees: 3,
  introduction: 'Product leader who has hired and mentored dozens of engineers and PMs.', categories: ['career', 'leadership'] } });
await call(`/api/v1/admin/mentorship/mentors/${mentor.id}/decide`, { token: admin, method: 'POST', body: { approve: true } });
ok('seeded an approved mentor and a member');

const browser = await chromium.launch();
const errors = [];
const pages = [];
async function signIn(who, viewport = { width: 1536, height: 1000 }) {
  const p = await (await browser.newContext({ viewport })).newPage();
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  pages.push(p);
  await p.goto(`${base}/`);
  await p.getByLabel('Email Address').fill(who.email);
  await p.getByPlaceholder('Enter your password').fill(PW);
  await p.getByRole('button', { name: 'Sign In' }).click();
  await p.waitForURL(/\/portal$/);
  return p;
}
const shot = (p, n) => p.screenshot({ path: `${out}/${n}.png` });
const fail = async (e) => { for (const [i, p] of pages.entries()) await p.screenshot({ path: `${out}/FAILED-${i}.png`, fullPage: true }).catch(() => {}); console.log('FAILED:', e.message.split('\n')[0]); console.log(errors.join('\n')); process.exit(1); };
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);

const a = await signIn(mentee);
await a.goto(`${base}/portal/mentorship`);
await a.getByRole('heading', { name: 'Alumni Mentorship Program' }).waitFor();
await a.getByRole('button', { name: 'Leadership' }).first().click();
await a.getByLabel('Search mentors').fill(stamp);
await a.getByRole('button', { name: new RegExp(`^${mentor.name}`) }).waitFor();
await shot(a, '01-find-mentor');
await a.locator('div.rounded-card', { has: a.getByRole('button', { name: new RegExp(`^${mentor.name}`) }) }).getByRole('button', { name: 'Request Mentorship' }).click();
await a.getByLabel('What would you like help with?').fill('Moving into product management');
await a.getByLabel('Your goals').fill('Understand the PM role and build a 6-month plan to transition.');
await a.getByRole('button', { name: 'Send request' }).click();
await a.waitForURL(/\/portal\/mentorship\/requests\//);
ok('member found a mentor by category and sent a request');
await a.goto(`${base}/portal/mentorship`);
await a.getByRole('button', { name: 'Let mentors find me' }).click();
await a.getByRole('dialog').getByRole('button', { name: 'Career Guidance' }).click();
await a.getByLabel('My goals').fill('Grow into product leadership');
await a.getByRole('button', { name: 'Save' }).click();
await a.getByText('Mentors can now find you and offer mentorship.').waitFor();
ok('member listed themselves for mentors');

const m = await signIn(mentor);
await m.goto(`${base}/portal/mentorship/tab/requests`);
await m.getByText('Waiting for your reply (1)').waitFor();
await m.getByRole('button', { name: 'Accept' }).click();
await m.getByText('Accepted — schedule your first session.').waitFor();
await m.getByRole('tab', { name: 'Find a Mentee' }).click();
await m.getByText(mentee.name).waitFor();
await m.getByText('Mentorship open').waitFor();
await shot(m, '02-find-mentee');
ok('mentor accepted from the requests tab; Find a Mentee lists the member');

const req = (await call('/api/v1/mentorship/requests?role=mentor', { token: mentor.token }))[0];
await call(`/api/v1/mentorship/requests/${req.id}/sessions`, { token: mentor.token, method: 'POST', body: { scheduled_at: new Date(Date.now() + 2 * 86400000).toISOString(), format: 'video', location: 'https://meet.example.org/x' } });
await a.goto(`${base}/portal/mentorship/tab/sessions`);
await a.getByText('Moving into product management').first().waitFor();
await a.getByRole('heading', { name: 'Upcoming Sessions' }).waitFor();
await shot(a, '03-sessions');
ok('sessions tab and upcoming sessions');

const mob = await signIn(mentee, { width: 390, height: 844 });
for (const path of ['/portal/mentorship', '/portal/mentorship/tab/requests', '/portal/mentorship/tab/sessions']) {
  await mob.goto(`${base}${path}`);
  await mob.waitForLoadState('networkidle');
  const overflow = await mob.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) throw new Error(`${path} overflows by ${overflow}px on mobile`);
}
ok('no horizontal overflow at 390px');
await browser.close();
if (errors.length) { console.log('Errors:\n' + errors.join('\n')); process.exit(1); }
console.log('No page errors.');

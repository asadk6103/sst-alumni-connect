// Redesign phase 4b: Jobs list (filters, bookmark, infinite list), job detail (sections, similar, refer, apply), job alerts.
//   node scripts/e2e-redesign-4b.mjs <appBase> <adminEmail> <adminPassword> <outDir>
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
const email = `jobtest-${stamp}@example.org`;
await call('/api/v1/auth/register', { method: 'POST', body: { full_name: `Javeria ${stamp}`, email, phone: '+923001234567', password: PW, accept_terms: true, graduation_year: 2011, admission_year: 2001, city: 'Lahore', country: 'Pakistan' } });
const row = (await fetch(`${base}/api/v1/admin/alumni?q=${encodeURIComponent(email)}`, { headers: { authorization: `Bearer ${admin}` } }).then((r) => r.json())).data[0];
await call(`/api/v1/admin/verification/${row.id}/approve`, { token: admin, method: 'POST', body: {} });
await call('/api/v1/admin/config/settings/security', { token: admin, method: 'PUT', body: security });
const job = (title, extra = {}) => ({ title, organization: `Nimbus ${stamp}`, employment_type: 'full_time', location: 'Karachi, Pakistan', experience: '5+ years', remote: true,
  description: 'Lead product design for our analytics suite used across the region.', responsibilities: ['Own the design system', 'Mentor designers'],
  requirements: ['5 years of product design', 'Figma'], benefits: ['Competitive Salary', 'Health Insurance', 'Flexible Work'], ...extra });
const j1 = await call('/api/v1/jobs', { token: admin, method: 'POST', body: job(`Lead Designer ${stamp}`) });
await call('/api/v1/jobs', { token: admin, method: 'POST', body: job(`UX Researcher ${stamp}`) });
ok('seeded a member and two approved jobs');

const browser = await chromium.launch();
const errors = [];
const pages = [];
async function signIn(viewport = { width: 1536, height: 1000 }) {
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
const shot = (p, n) => p.screenshot({ path: `${out}/${n}.png` });
const fail = async (e) => { for (const [i, p] of pages.entries()) await p.screenshot({ path: `${out}/FAILED-${i}.png`, fullPage: true }).catch(() => {}); console.log('FAILED:', e.message.split('\n')[0]); console.log(errors.join('\n')); process.exit(1); };
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);

const p = await signIn();
await p.goto(`${base}/portal/jobs`);
await p.getByRole('heading', { name: 'Alumni Career Network' }).waitFor();
await p.getByLabel('Search jobs').fill(stamp);
await p.getByText('2 Job Opportunities').waitFor();
await p.getByRole('button', { name: 'Internship' }).click();
await p.getByText('0 Job Opportunities').waitFor();
await p.getByRole('button', { name: 'Remote' }).click();
await p.getByText('2 Job Opportunities').waitFor();
const card = p.locator('div.rounded-card', { has: p.getByRole('link', { name: `Lead Designer ${stamp}` }) });
await card.getByRole('button', { name: 'Save job' }).click();
await p.getByText('Job saved.').waitFor();
await shot(p, '01-jobs');
ok('jobs list: search, filter tiles, save');

await card.getByRole('link', { name: 'View Details' }).click();
await p.getByRole('heading', { name: `Lead Designer ${stamp}` }).waitFor();
await p.getByRole('heading', { name: 'Key Responsibilities' }).waitFor();
await p.getByText('Health Insurance').waitFor();
await p.getByRole('link', { name: new RegExp(`UX Researcher ${stamp}`) }).waitFor(); // similar
await p.getByRole('button', { name: 'Apply Now' }).click();
await p.getByRole('dialog').getByText('Send application').waitFor();
await p.getByRole('button', { name: 'Cancel' }).click();
await p.getByRole('button', { name: 'Refer a Candidate' }).first().click();
await p.getByRole('button', { name: 'Someone else' }).click();
await p.getByLabel('Candidate name').fill('Outside Friend');
await p.getByLabel('Candidate email').fill('friend@example.org');
await p.getByRole('button', { name: 'Send Referral' }).click();
await p.getByText('Referral sent to the job poster.').waitFor();
await shot(p, '02-job-detail');
ok('job detail: sections, similar jobs, apply dialog, referral');

await p.goto(`${base}/portal/jobs/tab/alerts`);
await p.getByLabel('Keywords').fill('designer');
await p.getByRole('button', { name: 'Create Alert' }).click();
await p.getByText('Job alert created', { exact: false }).waitFor();
await p.goto(`${base}/portal/jobs/tab/saved`);
await p.getByRole('link', { name: `Lead Designer ${stamp}` }).waitFor();
await p.goto(`${base}/portal/jobs/tab/referrals`);
await p.getByText('Outside Friend').waitFor();
ok('alerts, saved jobs and referrals sections');

const m = await signIn({ width: 390, height: 844 });
for (const path of ['/portal/jobs', `/portal/jobs/${j1.id}`, '/portal/jobs/tab/alerts']) {
  await m.goto(`${base}${path}`);
  await m.waitForLoadState('networkidle');
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) throw new Error(`${path} overflows by ${overflow}px on mobile`);
}
await shot(m, '03-job-mobile');
ok('no horizontal overflow at 390px');
await browser.close();
if (errors.length) { console.log('Errors:\n' + errors.join('\n')); process.exit(1); }
console.log('No page errors.');

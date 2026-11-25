// Browser walk-through of Stage 3 engagement: events + QR check-in, jobs, mentorship, achievements.
//   node scripts/e2e-stage3-engagement.mjs <appBase> <adminEmail> <adminPassword> <outDir>
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const [base, adminEmail, adminPassword, out] = process.argv.slice(2);
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
const login = async (email, password) => (await call('/api/v1/auth/login', { method: 'POST', body: { email, password } })).access_token;
const admin = await login(adminEmail, adminPassword);
const security = await call('/api/v1/admin/config/settings/security', { token: admin });
await call('/api/v1/admin/config/settings/security', { token: admin, method: 'PUT', body: { ...security, require_email_verification: false } });
const restore = () => call('/api/v1/admin/config/settings/security', { token: admin, method: 'PUT', body: security }).catch(() => {});
async function member(name, email) {
  await call('/api/v1/auth/register', { method: 'POST', body: { full_name: name, email, phone: '+923001234567', password: PW, accept_terms: true,
    graduation_year: 2012, admission_year: 2002, city: 'Karachi', country: 'Pakistan', designation: 'Engineer', organization: 'Systems Ltd' } });
  const row = (await fetch(`${base}/api/v1/admin/alumni?q=${encodeURIComponent(email)}`, { headers: { authorization: `Bearer ${admin}` } }).then((r) => r.json())).data[0];
  await call(`/api/v1/admin/verification/${row.id}/approve`, { token: admin, method: 'POST', body: {} });
  return { id: row.id, email, name };
}
const A = await member(`Adeel ${stamp}`, `adeel-${stamp}@example.org`);
const B = await member(`Bushra ${stamp}`, `bushra-${stamp}@example.org`);
ok('seeded two verified alumni');

const browser = await chromium.launch();
const errors = [];
const pages = [];
async function signIn(email, password = PW, viewport = { width: 1440, height: 900 }) {
  const page = await (await browser.newContext({ viewport })).newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(`console(${email}): ${m.text()}`); });
  page.on('response', async (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()} ${(await r.text().catch(() => '')).slice(0, 200)}`); });
  await page.goto(`${base}/login`);
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(portal|admin)$/);
  pages.push(page);
  return page;
}
const shot = (p, n) => p.screenshot({ path: `${out}/${n}.png`, fullPage: true });
const fail = async (e) => {
  for (const [i, p] of pages.entries()) await p.screenshot({ path: `${out}/FAILED-${i}.png`, fullPage: true }).catch(() => {});
  console.log('FAILED:', e.message.split('\n')[0]);
  console.log(errors.join('\n'));
  await restore();
  process.exit(1);
};
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);
const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

// ── events ──────────────────────────────────────────────────────────────────
const adm = await signIn(adminEmail, adminPassword);
await adm.getByRole('link', { name: 'Events Management' }).click();
await adm.getByRole('button', { name: 'New event' }).click();
const title = `Reunion ${stamp}`;
const start = new Date(Date.now() + 5 * 86400000);
await adm.getByLabel('Title').fill(title);
await adm.getByLabel('Starts').fill(local(start));
await adm.getByLabel('Ends').fill(local(new Date(start.getTime() + 4 * 3600000)));
await adm.getByLabel('Venue').fill('SST Campus, Rashidabad');
await adm.getByLabel('Capacity').fill('50');
await adm.getByLabel('Summary').fill('Dinner, campus tour and batch photos');
await adm.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
await adm.waitForURL(/\/admin\/events\/[0-9a-f-]+$/);
await adm.getByRole('button', { name: 'Publish' }).click();
await adm.getByText('Event published.').waitFor();
await shot(adm, '01-admin-event');
ok('admin created and published an event');

const a = await signIn(A.email);
await a.getByRole('link', { name: 'Events', exact: true }).click();
await a.getByText(title).first().click();
await a.getByRole('button', { name: 'Register now' }).click();
await a.getByRole('dialog').getByRole('button', { name: 'Confirm registration' }).click();
await a.getByText('Show this code at the entrance').waitFor();
await shot(a, '02-member-ticket');
const code = (await a.locator('p.font-mono').innerText()).trim();
ok('member registered and sees the QR ticket');
const fullCode = (await call(`/api/v1/events/${adm.url().split('/').pop()}`, { token: await login(A.email, PW) })).my_registration.checkin_code;
await adm.getByRole('tab', { name: 'Check-in' }).click();
await adm.getByLabel('Ticket code').fill(`sst-ticket:${fullCode}`);
await adm.getByRole('button', { name: 'Check in', exact: true }).click();
await adm.getByText(/checked in$/).waitFor();
await shot(adm, '03-checkin');
await adm.getByRole('tab', { name: 'Registrations' }).click();
await adm.locator('td').getByText('attended').first().waitFor();
ok(`attendance recorded from the ticket code (${code})`);

// ── jobs ────────────────────────────────────────────────────────────────────
await a.goto(`${base}/portal/jobs/post`);
const job = `Backend Engineer ${stamp}`;
await a.getByLabel('Job title *').fill(job);
await a.getByLabel('Organisation *').fill('Systems Ltd');
await a.getByLabel('Location *').fill('Karachi');
await a.getByLabel('Skills').fill('Python, PostgreSQL');
await a.getByLabel('Description *').fill('Design and build reliable APIs used by banks across Pakistan. Python experience needed.');
await a.getByText('I can refer suitable alumni').click();
await a.getByRole('button', { name: 'Submit job' }).click();
await a.getByText('Waiting for review by the career office').waitFor();
ok('member posted a job (waiting for review)');
await adm.goto(`${base}/admin/jobs`);
await adm.getByRole('row', { name: new RegExp(job) }).getByRole('button', { name: 'Approve' }).click();
await adm.getByText('Job approved and listed.').waitFor();
await shot(adm, '04-admin-jobs');
ok('career office approved the job');
const b = await signIn(B.email);
await b.getByRole('link', { name: 'Jobs', exact: true }).click();
await b.getByLabel('Search jobs').fill(stamp);
await b.getByRole('link', { name: job }).click();
await b.getByRole('button', { name: 'Apply now' }).click();
const cv = `${out}/cv.pdf`;
writeFileSync(cv, '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
await b.locator('input[type=file]').setInputFiles(cv);
await b.getByText('CV uploaded.').waitFor();
await b.getByLabel('Cover letter (optional)').fill('I have five years of Python experience.');
await b.getByRole('button', { name: 'Send application' }).click();
await b.getByText('You applied').waitFor();
await shot(b, '05-job-applied');
ok('another member applied with a CV');
await a.goto(`${base}/portal/jobs/tab/postings`);
await a.getByRole('link', { name: job }).waitFor();
await a.locator('li', { hasText: job }).getByRole('link').last().click();
await a.getByLabel(`Status of ${B.name}`).selectOption('shortlisted');
await a.getByText('Status updated').waitFor();
await b.goto(`${base}/portal/jobs/tab/applications`);
await b.getByText('shortlisted').waitFor();
ok('poster shortlisted; applicant sees the status');

// ── mentorship ──────────────────────────────────────────────────────────────
await a.goto(`${base}/portal/mentorship/tab/become`);
await a.getByLabel('Industry').selectOption('Information Technology');
await a.getByLabel('Areas of expertise').fill('Backend engineering, Career planning');
await a.getByLabel('Short introduction').fill('Engineer at Systems Ltd; happy to help with careers in software.');
await a.getByRole('button', { name: 'Apply to become a mentor' }).click();
await a.getByText('Application under review').waitFor();
await adm.goto(`${base}/admin/mentorship`);
await adm.getByRole('row', { name: new RegExp(A.name) }).getByRole('button', { name: 'Approve' }).click();
await adm.getByText('Mentor approved.').waitFor();
ok('member applied as mentor; coordinator approved');
await b.goto(`${base}/portal/mentorship`);
await b.getByLabel('Search mentors').fill(stamp);
await b.getByRole('button', { name: 'View profile' }).first().click();
await b.getByRole('button', { name: 'Request mentorship' }).click();
await b.getByLabel('What would you like help with?').fill('Moving into backend engineering');
await b.getByLabel('Your goals').fill('Plan the skills I need and prepare for interviews.');
await b.getByRole('button', { name: 'Send request' }).click();
await b.waitForURL(/\/portal\/mentorship\/requests\//);
const reqUrl = b.url();
await a.goto(reqUrl);
await a.getByRole('button', { name: 'Accept' }).click();
await a.getByText('Reply sent.').waitFor();
await shot(a, '06-mentorship-accepted');
ok('mentee requested; mentor accepted');

// ── achievements ────────────────────────────────────────────────────────────
await b.goto(`${base}/portal/achievements`);
await b.getByRole('button', { name: 'Nominate an alumnus' }).click();
await b.getByPlaceholder('Search alumni by name…').fill(stamp);
await b.getByRole('dialog').getByRole('button', { name: new RegExp(A.name) }).click();
await b.getByLabel('Title').fill(`Mentor of the year ${stamp}`);
await b.getByLabel('Why should they be recognised?').fill('Adeel has mentored many young engineers and referred them to great jobs.');
await b.getByRole('button', { name: 'Send nomination' }).click();
await b.getByText('alumni office will review').waitFor();
await adm.goto(`${base}/admin/achievements`);
const row = adm.getByRole('row', { name: new RegExp(`Mentor of the year ${stamp}`) });
await row.getByRole('button', { name: 'Edit' }).click();
await adm.getByLabel('Summary').fill('Mentoring the next generation of SST engineers.');
await adm.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
await adm.getByText('Saved.').first().waitFor();
await row.getByRole('button', { name: 'Publish' }).click();
await adm.getByText('Done.').first().waitFor();
await b.goto(`${base}/portal/achievements`);
await b.getByText(`Mentor of the year ${stamp}`).first().waitFor();
await shot(b, '07-achievements');
ok('nomination reviewed and published');

// ── dashboard and mobile ────────────────────────────────────────────────────
await a.goto(`${base}/portal`);
await a.getByText('Upcoming events').first().waitFor();
await shot(a, '08-dashboard');
const m = await signIn(B.email, PW, { width: 390, height: 844 });
for (const path of ['/portal/events', '/portal/jobs', '/portal/mentorship', '/portal/achievements', reqUrl.replace(base, '')]) {
  await m.goto(`${base}${path}`);
  await m.waitForLoadState('networkidle');
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) throw new Error(`${path} overflows by ${overflow}px on mobile`);
}
await m.goto(`${base}/portal/events`);
await shot(m, '09-mobile-events');
ok('dashboard widgets; no horizontal overflow at 390px');

await restore();
await browser.close();
if (errors.length) { console.log('Errors:\n' + errors.join('\n')); process.exit(1); }
console.log('No page errors.');

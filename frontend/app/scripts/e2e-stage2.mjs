// Browser walk-through of Stage 2 (needs an installed site; the Stage 1 script installs one).
//   node scripts/e2e-stage2.mjs <appBase> <adminEmail> <adminPassword> <outDir>
// Registration, profile, privacy, verification queue, school records, codes, batches, directory, connections.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const [base, adminEmail, adminPassword, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const stamp = Date.now().toString(36);
const PW = 'Str0ngPassword!';
const ok = (m) => console.log('✓', m);

// ── API helpers (seed data and switch email verification off for the run) ──
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
const restore = () => call('/api/v1/admin/config/settings/security', { token: admin, method: 'PUT', body: security }).catch(() => {});
await call('/api/v1/admin/batches/generate', { token: admin, method: 'POST', body: { from_year: 2005, to_year: 2020 } });
// a verified batchmate to find and connect with
const peerEmail = `peer-${stamp}@example.org`;
const peerName = `Hira Batchmate ${stamp}`;
await call('/api/v1/auth/register', { method: 'POST', body: { full_name: peerName, email: peerEmail, phone: '+923001110000', password: PW,
  accept_terms: true, graduation_year: 2014, admission_year: 2004, city: 'Dubai', country: 'United Arab Emirates', designation: 'Cardiologist',
  organization: 'City Hospital' } });
const peerList = await fetch(`${base}/api/v1/admin/alumni?q=${peerEmail}`, { headers: { authorization: `Bearer ${admin}` } }).then((r) => r.json());
await call(`/api/v1/admin/verification/${peerList.data[0].id}/approve`, { token: admin, method: 'POST', body: {} });
ok('seeded batches 2005–2020 and a verified batchmate');

const browser = await chromium.launch();
const errors = [];
async function newPage(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|socket\.io|status of 4\d\d/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('response', async (r) => {
    if (r.status() >= 500 && r.url().includes('/api/')) errors.push(`HTTP ${r.status()} ${r.url()} ${(await r.text().catch(() => '')).slice(0, 300)}`);
  });
  return page;
}
const member = await newPage();
const shot = (p, n) => p.screenshot({ path: `${out}/${n}.png`, fullPage: true });
const fail = async (e) => {
  await member.screenshot({ path: `${out}/FAILED.png`, fullPage: true }).catch(() => {});
  console.log('FAILED:', e.message.split('\n')[0]);
  console.log(errors.join('\n'));
  await restore();
  process.exit(1);
};
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);

// ── registration ────────────────────────────────────────────────────────────
const email = `ayesha-${stamp}@example.org`;
await member.goto(`${base}/login`);
await member.getByRole('link', { name: 'Create an alumni account' }).click();
await member.waitForURL(/\/register$/);
await member.getByLabel('Full name').fill('Ayesha Siddiqui');
await member.getByLabel('Email address').fill(email);
await member.getByLabel('Mobile number').fill('+92 321 5550101');
await member.getByRole('textbox', { name: 'Password', exact: true }).fill(PW);
await member.getByLabel('Confirm password').fill(PW);
await shot(member, '01-register-account');
await member.getByRole('button', { name: 'Continue' }).click();
await member.getByLabel('Admission year').selectOption('2004');
await member.getByLabel('Graduation year').selectOption('2014');
await member.getByLabel('Batch').selectOption({ label: 'Class of 2014' });
await member.getByLabel('Student registration number').fill(`SST-${stamp}`);
await shot(member, '02-register-school');
await member.getByRole('button', { name: 'Continue' }).click();
await member.getByLabel('Current city').fill('Lahore');
await member.getByLabel('Current occupation').fill('Software Engineer');
await member.getByLabel('Current organisation').fill('Arbisoft');
await member.getByText(/I confirm these details are correct/).click();
await member.getByRole('button', { name: 'Create account' }).click();
await member.getByText('Registration received').waitFor();
await shot(member, '03-register-done');
ok('registered through the three-step form');

await member.getByRole('link', { name: 'Go to sign in' }).click();
await member.getByLabel('Email address').fill(email);
await member.getByRole('textbox', { name: 'Password' }).fill(PW);
await member.getByRole('button', { name: 'Sign in' }).click();
await member.waitForURL(/\/portal$/);
await member.getByText('Your profile is waiting for verification').waitFor();
await shot(member, '04-dashboard-unverified');
ok('member lands on the dashboard with the verification notice');
if (await member.getByRole('link', { name: 'Alumni Directory' }).count()) throw new Error('directory link visible to an unverified member');
await member.goto(`${base}/portal/directory`);
await member.getByText('Available to verified alumni').waitFor();
ok('directory closed to unverified members');

// ── profile ─────────────────────────────────────────────────────────────────
await member.goto(`${base}/portal/profile`);
await member.getByLabel('Short biography').fill('Backend engineer in Lahore. Happy to help SST students with careers in technology.');
await member.getByRole('button', { name: 'Save' }).click();
await member.getByText('Profile saved.').first().waitFor();
await member.getByRole('button', { name: 'Professional' }).click();
await member.getByLabel('Industry').selectOption('Information Technology');
await member.getByLabel('LinkedIn profile').fill('linkedin.com/in/ayesha-example');
for (const s of ['Python', 'PostgreSQL', 'Mentoring']) { await member.getByLabel('Skills').fill(s); await member.keyboard.press('Enter'); }
await member.getByRole('button', { name: 'Save' }).click();
await member.getByText('Profile saved.').first().waitFor();
await shot(member, '05-profile-professional');
await member.getByRole('button', { name: 'Experience' }).click();
await member.getByRole('button', { name: 'Add position' }).click();
await member.getByLabel('Designation').fill('Senior Software Engineer');
await member.getByLabel('Organisation').fill('Arbisoft');
await member.getByLabel('Start date').fill('2019-02-01');
await member.getByText('I currently work here').click();
await member.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
await member.getByText('Senior Software Engineer').first().waitFor();
await member.getByRole('button', { name: 'Privacy' }).click();
await member.getByLabel('Who can see: Current position, organisation, industry and experience').selectOption('connections');
await member.getByRole('button', { name: 'Save' }).click();
await member.getByText('Privacy settings saved.').waitFor();
await shot(member, '06-privacy');
await member.getByRole('button', { name: 'Verification' }).click();
await member.getByText('Have a code from the alumni office?').waitFor();
await shot(member, '07-verification-options');
ok('profile, experience, skills, privacy and verification tabs work');

// ── administration ──────────────────────────────────────────────────────────
const adm = await newPage();
await adm.goto(`${base}/login`);
await adm.getByLabel('Email address').fill(adminEmail);
await adm.getByRole('textbox', { name: 'Password' }).fill(adminPassword);
await adm.getByRole('button', { name: 'Sign in' }).click();
await adm.waitForURL(/\/admin$/);
await adm.getByText('Pending verification').first().waitFor();
await shot(adm, '10-admin-dashboard');
await adm.getByRole('link', { name: 'Alumni Verification' }).click();
await adm.getByRole('button', { name: email }).click();
await adm.getByRole('dialog').getByText('School record match').first().waitFor();
await shot(adm, '11-verification-detail');
await adm.getByRole('dialog').getByRole('button', { name: 'Verify' }).click();
await adm.getByRole('dialog', { name: /Verify Ayesha/ }).getByRole('button', { name: 'Verify' }).click();
await adm.getByText('Ayesha Siddiqui is now verified.').waitFor();
await adm.keyboard.press('Escape');
ok('administrator verified the registration from the queue');

await adm.getByRole('tab', { name: 'School records' }).click();
await adm.getByRole('button', { name: 'Import CSV' }).first().click();
const csv = `${out}/records.csv`;
writeFileSync(csv, `registration_no,full_name,graduation_year,batch,email\nREC-${stamp}-1,Usman Tariq,2012,Class of 2012,usman-${stamp}@example.org\nREC-${stamp}-2,Bad Row,abcd,,\n`);
await adm.locator('input[type=file]').setInputFiles(csv);
await adm.getByRole('button', { name: 'Check file' }).click();
await adm.getByText('File checked — nothing saved yet').waitFor();
await shot(adm, '12-import-dry-run');
await adm.getByRole('button', { name: /Import 1 record/ }).click();
await adm.getByText('Import complete').waitFor();
await adm.getByRole('button', { name: 'Done' }).click();
await adm.getByText(`REC-${stamp}-1`).waitFor();
await shot(adm, '13-school-records');
ok('CSV import: dry run reports the bad row, then imports the good one');

await adm.getByRole('tab', { name: 'Verification codes' }).click();
await adm.getByRole('button', { name: 'Issue codes' }).click();
await adm.getByLabel('Label').fill('Reunion desk');
await adm.getByRole('button', { name: 'Issue' }).click();
await adm.getByText('1 code(s) issued').waitFor();
await shot(adm, '14-codes-issued');
await adm.getByRole('button', { name: 'Done' }).click();
ok('verification code issued and shown once');

await adm.getByRole('link', { name: 'Batch Management' }).click();
await adm.getByText('Class of 2014').waitFor();
await shot(adm, '15-batches');
await adm.getByRole('link', { name: 'Alumni Management' }).click();
await adm.getByText('Ayesha Siddiqui').first().waitFor();
await shot(adm, '16-alumni-management');
await adm.goto(`${base}/admin/configuration/alumni`);
await adm.getByText('Registration is open').waitFor();
await shot(adm, '17-config-alumni');
await adm.goto(`${base}/admin/configuration/dashboard`);
await adm.getByText('People you may know').waitFor();
await shot(adm, '18-config-widgets');
ok('batches, alumni management and the new configuration sections render');

// ── verified member: directory, profile, connections ────────────────────────
await member.goto(`${base}/login`);
await member.evaluate(() => fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' }));
await member.goto(`${base}/login`);
await member.getByLabel('Email address').fill(email);
await member.getByRole('textbox', { name: 'Password' }).fill(PW);
await member.getByRole('button', { name: 'Sign in' }).click();
await member.waitForURL(/\/portal$/);
await member.getByText('People you may know').waitFor();
await shot(member, '20-dashboard-verified');
await member.getByRole('link', { name: 'Alumni Directory' }).click();
await member.getByLabel('Search alumni').fill(stamp);
await member.getByText(peerName).first().waitFor();
await shot(member, '21-directory-grid');
await member.getByRole('button', { name: 'list view' }).click();
await shot(member, '22-directory-list');
await member.getByRole('link', { name: peerName }).first().click();
await member.getByRole('dialog').getByText('Experience').waitFor();
await member.getByRole('dialog').getByRole('button', { name: 'Connect' }).click();
await member.getByText('Connection request sent.').waitFor();
await member.keyboard.press('Escape');
await member.goto(`${base}/portal/connections/sent`);
await member.getByText(peerName).waitFor();
await shot(member, '23-connections-sent');
ok('directory search, grid/list, preview and connection request work');

// the batchmate sees the request and accepts it
const peer = await newPage();
await peer.goto(`${base}/login`);
await peer.getByLabel('Email address').fill(peerEmail);
await peer.getByRole('textbox', { name: 'Password' }).fill(PW);
await peer.getByRole('button', { name: 'Sign in' }).click();
await peer.waitForURL(/\/portal$/);
await peer.getByText('Connection requests').waitFor();
await peer.getByRole('button', { name: 'Accept' }).first().click();
await peer.getByText('You are now connected.').waitFor();
await shot(peer, '24-peer-accepted');
ok('batchmate accepted from the dashboard widget');

// ── mobile layout ───────────────────────────────────────────────────────────
const mobile = await newPage({ width: 390, height: 844 });
for (const path of ['/register', '/login']) {
  await mobile.goto(`${base}${path}`);
  await mobile.waitForLoadState('networkidle');
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) throw new Error(`${path} overflows horizontally by ${overflow}px on mobile`);
}
await mobile.goto(`${base}/register`);
await shot(mobile, '30-mobile-register');
const mctx = member.context();
const mm = await mctx.newPage();
await mm.setViewportSize({ width: 390, height: 844 });
for (const path of ['/portal', '/portal/directory', '/portal/profile', '/portal/connections']) {
  await mm.goto(`${base}${path}`);
  await mm.waitForLoadState('networkidle');
  const overflow = await mm.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) throw new Error(`${path} overflows horizontally by ${overflow}px on mobile`);
}
await mm.goto(`${base}/portal/directory`);
await mm.waitForLoadState('networkidle');
await mm.screenshot({ path: `${out}/31-mobile-directory.png`, fullPage: true });
ok('no horizontal overflow at 390px on registration and portal pages');

await restore();
await browser.close();
if (errors.length) { console.log('Errors:\n' + errors.join('\n')); process.exit(1); }
console.log('No page errors.');

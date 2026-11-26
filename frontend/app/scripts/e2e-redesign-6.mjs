// Redesign phase 6: Settings (all sections, saved and applied) and Help & Support (tickets, FAQs) + admin Help Desk.
//   node scripts/e2e-redesign-6.mjs <appBase> <adminEmail> <adminPassword> <outDir>
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
const email = `settings-${stamp}@example.org`;
await call('/api/v1/auth/register', { method: 'POST', body: { full_name: `Sana ${stamp}`, email, phone: '+923001234567', password: PW, accept_terms: true, graduation_year: 2010, admission_year: 2000, city: 'Lahore', country: 'Pakistan' } });
const row = (await fetch(`${base}/api/v1/admin/alumni?q=${encodeURIComponent(email)}`, { headers: { authorization: `Bearer ${admin}` } }).then((r) => r.json())).data[0];
await call(`/api/v1/admin/verification/${row.id}/approve`, { token: admin, method: 'POST', body: {} });
await call('/api/v1/admin/config/settings/security', { token: admin, method: 'PUT', body: security });
const tok = (await call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW } })).access_token;
ok('seeded a verified member');

const browser = await chromium.launch();
const errors = [];
const pages = [];
async function signIn(who, password, viewport = { width: 1536, height: 1000 }, landing = /\/portal$/) {
  const p = await (await browser.newContext({ viewport, acceptDownloads: true })).newPage();
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  pages.push(p);
  await p.goto(`${base}/`);
  await p.getByLabel('Email Address').fill(who);
  await p.getByPlaceholder('Enter your password').fill(password);
  await p.getByRole('button', { name: 'Sign In' }).click();
  await p.waitForURL(landing);
  return p;
}
const shot = (p, n) => p.screenshot({ path: `${out}/${n}.png` });
const fail = async (e) => { for (const [i, p] of pages.entries()) await p.screenshot({ path: `${out}/FAILED-${i}.png`, fullPage: true }).catch(() => {}); console.log('FAILED:', e.message.split('\n')[0]); console.log(errors.join('\n')); process.exit(1); };
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);
const settings = () => call('/api/v1/me/settings', { token: tok });

const p = await signIn(email, PW);
await p.goto(`${base}/portal/account`);
await p.getByRole('heading', { name: 'Account Information' }).waitFor();
await p.getByRole('switch', { name: 'Show my online status' }).click();
await p.getByText('Saved.').first().waitFor();
if ((await settings()).show_online !== false) throw new Error('online status not saved');
await shot(p, '01-account');
ok('account & privacy: toggle saved');

await p.getByRole('link', { name: 'Visibility' }).click();
await p.getByLabel('Email Address').selectOption('only_me');
await p.getByText('Saved.').first().waitFor();
const me = await call('/api/v1/alumni/me', { token: tok });
if (me.privacy.sections.email !== 'only_me') throw new Error('email visibility not saved');
await p.getByRole('button', { name: 'As Public' }).click();
await p.getByText('Your profile is never shown outside the portal.').waitFor();
ok('visibility: field level + preview');

await p.getByRole('link', { name: 'Connections' }).click();
await p.getByText('Alumni from my batch only').click();
await p.waitForTimeout(600);
if ((await settings()).connection_requests !== 'batch') throw new Error('connection policy not saved');
ok('connections: request policy');

await p.getByRole('link', { name: 'Notifications' }).click();
await p.getByRole('heading', { name: 'Community & Engagement' }).waitFor();
if (!(await p.getByLabel('Posts & mentions: SMS').isDisabled())) throw new Error('SMS should be unavailable for mentions');
await p.getByText('Essential Only').click();
await p.getByText('Notification settings saved.').first().waitFor();
await shot(p, '02-notifications');
ok('notifications: channels and preset');

await p.getByRole('link', { name: 'Security' }).click();
await p.getByRole('heading', { name: 'Recent Login Activity' }).waitFor();
await p.getByText('Current Session').first().waitFor();
await p.getByRole('button', { name: 'Run Checkup' }).click();
await p.getByRole('dialog').getByText('Two-factor authentication').waitFor();
await p.getByRole('button', { name: 'Done' }).click();
await shot(p, '03-security');
ok('security: login activity and checkup');

await p.getByRole('link', { name: 'Preferences' }).click();
await p.getByRole('radio', { name: 'Dark' }).click();
await p.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
await shot(p, '04-preferences-dark');
await p.getByRole('radio', { name: 'Light' }).click();
await p.waitForFunction(() => document.documentElement.dataset.theme === 'light');
ok('preferences: dark mode applied and reverted');

await p.getByRole('link', { name: 'Language & Region' }).click();
await p.getByLabel('Date format').selectOption('YYYY-MM-DD');
await p.getByLabel('24-hour').check();
await p.getByRole('button', { name: 'Save Changes' }).click();
await p.getByText('Settings saved.').first().waitFor();
await p.getByText(/\d{4}-\d{2}-\d{2} · \d{2}:\d{2}/).waitFor();
ok('language & region: date format applied');

await p.getByRole('link', { name: 'Data & Privacy' }).click();
const dl = p.waitForEvent('download');
await p.getByRole('button', { name: 'Request Data Export' }).click();
await dl;
await p.getByText('Data export').first().waitFor();
ok('data & privacy: export recorded');

await p.getByRole('link', { name: 'Help & Support' }).click();
await p.getByLabel('Category').selectOption('account');
await p.getByLabel('Subject').fill(`Cannot update email ${stamp}`);
await p.getByLabel('Description').fill('The save button does nothing when I change my email.');
await p.getByRole('button', { name: 'Submit Ticket' }).click();
await p.getByText(/Ticket SST-\d+ submitted/).waitFor();
const ticket = (await call('/api/v1/support/tickets', { token: tok }))[0];
await shot(p, '05-help');
ok('help: ticket submitted');

const ad = await signIn(adminEmail, adminPassword, { width: 1536, height: 1000 }, /\/(admin|portal)/);
await ad.goto(`${base}/admin/support`);
await ad.getByText(`Cannot update email ${stamp}`).click();
await ad.getByLabel('Reply to member').fill('Thanks — please try again now.');
await ad.getByRole('button', { name: 'Send reply' }).click();
await ad.getByText('Reply sent — the member was notified.').waitFor();
await ad.keyboard.press('Escape');
await ad.getByRole('tab', { name: 'FAQs' }).click();
await ad.getByRole('button', { name: 'New FAQ' }).click();
await ad.getByLabel('Question').fill(`How do I verify my profile ${stamp}?`);
await ad.getByLabel('Answer').fill('Upload a document under My Profile › Verification.');
await ad.getByRole('button', { name: 'Save' }).click();
await ad.getByText('FAQ saved.').waitFor();
ok('admin help desk: reply and FAQ');

await p.goto(`${base}/portal/account/support?ticket=${ticket.id}`);
await p.getByText('Thanks — please try again now.').waitFor();
await p.keyboard.press('Escape');
await p.goto(`${base}/portal/account/support?tab=faqs`);
await p.getByLabel('Search FAQs').fill(stamp);
await p.getByRole('button', { name: new RegExp(`verify my profile ${stamp}`) }).first().click();
await p.getByText('Upload a document under My Profile').first().waitFor();
ok('member sees the staff reply and the new FAQ');
// restore defaults so later runs start clean for this member
await call('/api/v1/me/settings', { token: tok, method: 'PUT', body: { date_format: 'DD MMM, YYYY', time_format: '12' } });

const m = await signIn(email, PW, { width: 390, height: 844 });
for (const s of ['', '/notifications', '/security', '/connections', '/visibility', '/communities', '/preferences', '/language', '/data', '/support']) {
  await m.goto(`${base}/portal/account${s}`);
  await m.waitForLoadState('networkidle');
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) throw new Error(`/portal/account${s} overflows by ${overflow}px on mobile`);
}
await shot(m, '06-settings-mobile');
ok('no horizontal overflow at 390px');
await browser.close();
if (errors.length) { console.log('Errors:\n' + errors.join('\n')); process.exit(1); }
console.log('No page errors.');

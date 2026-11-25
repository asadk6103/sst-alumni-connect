// Browser walk-through of Stage 6 privacy features: data download, deletion request, admin approval.
//   node scripts/e2e-stage6.mjs <appBase> <adminEmail> <adminPassword> <outDir>
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
const email = `leaver-${stamp}@example.org`;
await call('/api/v1/auth/register', { method: 'POST', body: { full_name: `Leaver ${stamp}`, email, phone: '+923001234567', password: PW, accept_terms: true, graduation_year: 2010, admission_year: 2000, city: 'Lahore', country: 'Pakistan' } });
await call('/api/v1/admin/config/settings/security', { token: admin, method: 'PUT', body: security });

const browser = await chromium.launch();
const errors = [];
async function signIn(user, password, viewport = { width: 1440, height: 900 }) {
  const page = await (await browser.newContext({ viewport, acceptDownloads: true })).newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.goto(`${base}/login`);
  await page.getByLabel('Email address').fill(user);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(portal|admin)/);
  return page;
}
try {
  const m = await signIn(email, PW);
  await m.goto(`${base}/portal/account/privacy`);
  const [dl] = await Promise.all([m.waitForEvent('download'), m.getByRole('button', { name: 'Download my data' }).click()]);
  if (!dl.suggestedFilename().endsWith('.json')) throw new Error('no JSON download');
  ok('member downloaded their data');
  await m.getByRole('button', { name: 'Request account deletion' }).click();
  await m.getByLabel('Reason (optional)').fill('Testing the deletion workflow');
  await m.getByLabel(/Confirm with your password/).fill(PW);
  await m.getByRole('button', { name: 'Send request' }).click();
  await m.getByText('Deletion requested').waitFor();
  await m.screenshot({ path: `${out}/01-privacy.png`, fullPage: true });
  ok('member requested deletion');

  const a = await signIn(adminEmail, adminPassword);
  await a.goto(`${base}/admin/privacy`);
  const row = a.locator('li', { hasText: email });
  await row.getByRole('button', { name: 'Delete account' }).click();
  await a.getByRole('alertdialog').or(a.getByRole('dialog')).getByRole('button', { name: 'Delete account' }).click();
  await a.getByText('Account deleted (anonymised).').waitFor();
  await a.screenshot({ path: `${out}/02-admin-privacy.png`, fullPage: true });
  const r = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) });
  if (r.ok) throw new Error('deleted account can still sign in');
  ok('administrator approved; the account can no longer sign in');

  const mob = await signIn(adminEmail, adminPassword, { width: 390, height: 844 });
  for (const path of ['/admin/privacy', '/portal/account/privacy']) {
    await mob.goto(`${base}${path}`);
    await mob.waitForLoadState('networkidle');
    const overflow = await mob.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) throw new Error(`${path} overflows by ${overflow}px`);
  }
  ok('no horizontal overflow at 390px');
} catch (e) {
  console.log('FAILED:', e.message.split('\n')[0]);
  console.log(errors.join('\n'));
  await browser.close();
  process.exit(1);
}
await browser.close();
if (errors.length) { console.log('Errors:\n' + errors.join('\n')); process.exit(1); }
console.log('No page errors.');

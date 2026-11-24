// Browser walk-through of Stage 1: setup wizard → admin screens → portal account → sign out / sign in.
//   node scripts/e2e-stage1.mjs <appBase> <setupCode> <logoPath> <outDir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [base, code, logo, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('response', async (r) => {
  if (r.status() >= 400 && r.url().includes('/api/')) errors.push(`HTTP ${r.status()} ${r.url()} ${(await r.text().catch(() => '')).slice(0, 300)}`);
});
process.on('unhandledRejection', async (e) => {
  await page.screenshot({ path: `${out}/FAILED.png`, fullPage: true }).catch(() => {});
  console.log('FAILED:', e.message.split('\n')[0]);
  console.log(errors.join('\n'));
  process.exit(1);
});
const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, fullPage: true });
const cont = () => page.getByRole('button', { name: 'Continue' }).click();
const ok = (msg) => console.log('✓', msg);

await page.goto(`${base}/admin`);
await page.waitForURL(/\/(setup|login)$/);
if (page.url().endsWith('/setup')) {
ok('uninstalled site redirects to /setup');
await page.getByLabel('Setup code').fill(code);
await shot('01-welcome');
await cont();
await page.getByText('PostgreSQL').waitFor();
await shot('02-database');
await cont();
await shot('03-url');
await cont();
await page.getByLabel('Contact email').fill('alumni@sst.edu.pk');
await shot('04-institution');
await cont();
await page.locator('input[type=file]').first().setInputFiles(logo);
await page.locator('img[src*="/media/branding/"]').first().waitFor();
await shot('05-branding');
await cont();
await page.getByLabel('Full name').fill('Asad Mehmood');
await page.getByRole('textbox', { name: 'Email', exact: true }).fill('admin@sst.edu.pk');
await page.getByRole('textbox', { name: 'Password', exact: true }).fill('Str0ngPassword!');
await page.getByLabel('Confirm password').fill('Str0ngPassword!');
await shot('06-admin');
await cont();
await shot('07-email');
await cont();
await page.getByRole('button', { name: 'Test storage' }).click();
await page.getByText(/Local storage is writable/).waitFor();
await shot('08-storage');
await cont();
await page.getByLabel('Two-factor authentication').selectOption('optional');
await shot('09-security');
await cont();
await shot('10-review');
await page.getByRole('button', { name: 'Complete installation' }).click();
await page.waitForTimeout(3000);
await shot('10b-after-complete');
if (!/\/admin$/.test(page.url())) {
  console.log('NOT INSTALLED', errors.join('\n'));
  process.exit(1);
}
} else {
  // Already installed (re-run): sign in as the administrator created by the wizard.
  await page.getByLabel('Email address').fill('admin@sst.edu.pk');
  await page.getByRole('textbox', { name: 'Password' }).fill('Str0ngPassword!');
  await page.getByRole('button', { name: 'Sign in' }).click();
}
await page.waitForURL(/\/admin$/);
await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
await page.waitForLoadState('networkidle');
ok('installation completed and signed in as Super Administrator');
await shot('11-admin-dashboard');

for (const [path, heading, name] of [
  ['/admin/users', 'User Management', '12-users'], ['/admin/roles', 'Roles & Permissions', '13-roles'],
  ['/admin/configuration/general', 'System Configuration', '14-config-general'], ['/admin/configuration/branding', 'System Configuration', '15-config-branding'],
  ['/admin/configuration/security', 'System Configuration', '16-config-security'], ['/admin/configuration/modules', 'System Configuration', '17-config-modules'],
  ['/admin/configuration/email', 'System Configuration', '18-config-email'], ['/admin/configuration/sms', 'System Configuration', '19-config-sms'],
  ['/admin/communications', 'Communication Center', '20-communications'], ['/admin/media', 'Media Library', '21-media'],
  ['/admin/audit', 'Audit Logs', '22-audit'], ['/admin/health', 'System Health', '23-health'],
]) {
  await page.goto(`${base}${path}`);
  await page.getByRole('heading', { name: heading, exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  await shot(name);
}
ok('all admin screens render');

// Create a member from the admin UI
await page.goto(`${base}/admin/users`);
await page.getByRole('heading', { name: 'User Management' }).waitFor();
await page.waitForLoadState('networkidle');
if (!(await page.getByText('mahnoor@example.org').count())) {
  await page.getByRole('button', { name: 'Add user' }).click();
  await page.getByLabel('Full name').fill('Mahnoor Akbar');
  await page.getByRole('textbox', { name: 'Email' }).fill('mahnoor@example.org');
  await page.getByText('Email a link to set their password').click();
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('MemberPass2026');
  await page.getByRole('button', { name: 'Create user' }).click();
}
await page.getByText('mahnoor@example.org').waitFor();
ok('user created from the admin portal');

// Branding: change primary colour, preview, publish
await page.goto(`${base}/admin/configuration/branding`);
await page.getByLabel('Primary (buttons, active)', { exact: true }).fill('#0E7C66');
await shot('24-branding-draft');
await page.getByRole('button', { name: 'Publish' }).click();
await page.getByText('Branding published').waitFor();
ok('branding published');
await page.getByLabel('Primary (buttons, active)', { exact: true }).fill('#7138DB');
await page.getByRole('button', { name: 'Publish' }).click();
await page.getByText('Branding published').first().waitFor();

// Portal account and sign out
await page.goto(`${base}/portal/account`);
await page.getByRole('heading', { name: 'Account settings' }).waitFor();
await shot('25-portal-account');
await page.goto(`${base}/portal/account/security`);
await page.getByText("Where you're signed in").waitFor();
await page.getByRole('button', { name: 'Set up' }).click();
await page.locator('svg').filter({ has: page.locator('path') }).first().waitFor();
await shot('26-mfa-setup');
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Account menu' }).click();
await page.getByRole('menuitem', { name: 'Sign out' }).click();
await page.waitForURL(/\/login$/);
await shot('27-login');
ok('signed out');

// Member sign-in lands in the portal
await page.getByLabel('Email address').fill('mahnoor@example.org');
await page.getByRole('textbox', { name: 'Password' }).fill('MemberPass2026');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL(/\/portal\/account$/);
await page.goto(`${base}/admin/users`);
await page.waitForURL(/\/portal\/account$/);
ok('member signs in to the portal and cannot open the admin portal');
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${base}/portal/account`);
await page.getByRole('heading', { name: 'Account settings' }).waitFor();
await shot('28-portal-mobile');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok(`mobile horizontal overflow: ${overflow}px`);

await browser.close();
console.log(errors.length ? `Errors:\n${errors.join('\n')}` : 'No page errors.');

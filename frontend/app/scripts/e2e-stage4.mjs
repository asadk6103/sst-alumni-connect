// Browser walk-through of Stage 4: donations (pledge → confirm → receipt), notifications, newsletters, gallery.
//   node scripts/e2e-stage4.mjs <appBase> <adminEmail> <adminPassword> <outDir>
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

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
const admin = (await call('/api/v1/auth/login', { method: 'POST', body: { email: adminEmail, password: adminPassword } })).access_token;
const security = await call('/api/v1/admin/config/settings/security', { token: admin });
await call('/api/v1/admin/config/settings/security', { token: admin, method: 'PUT', body: { ...security, require_email_verification: false } });
const restore = () => call('/api/v1/admin/config/settings/security', { token: admin, method: 'PUT', body: security }).catch(() => {});
const email = `donor-${stamp}@example.org`;
await call('/api/v1/auth/register', { method: 'POST', body: { full_name: `Dania ${stamp}`, email, phone: '+923001234567', password: PW, accept_terms: true,
  graduation_year: 2012, admission_year: 2002, city: 'Lahore', country: 'Pakistan' } });
const row = (await fetch(`${base}/api/v1/admin/alumni?q=${encodeURIComponent(email)}`, { headers: { authorization: `Bearer ${admin}` } }).then((r) => r.json())).data[0];
await call(`/api/v1/admin/verification/${row.id}/approve`, { token: admin, method: 'POST', body: {} });
ok('seeded a verified member');

// a small valid PNG for the gallery upload
function png() {
  const crc = (buf) => { let c, crcv = -1; for (let n = 0; n < buf.length; n++) { c = (crcv ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcv = (crcv >>> 8) ^ c; } return (crcv ^ -1) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const w = 64, h = 48; const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; raw[i] = 113; raw[i + 1] = 56 + y; raw[i + 2] = 219; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const browser = await chromium.launch();
const errors = [];
const pages = [];
async function signIn(user, password = PW, viewport = { width: 1440, height: 900 }) {
  const page = await (await browser.newContext({ viewport })).newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('response', async (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()} ${(await r.text().catch(() => '')).slice(0, 200)}`); });
  await page.goto(`${base}/login`);
  await page.getByLabel('Email address').fill(user);
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

// ── donations ───────────────────────────────────────────────────────────────
const adm = await signIn(adminEmail, adminPassword);
await adm.goto(`${base}/admin/configuration/donations`);
await adm.getByLabel('Bank name').fill('HBL');
await adm.getByLabel('Account title').fill('SST Alumni Fund');
await adm.getByLabel('IBAN').fill('PK36HABB0000001234567890');
await adm.getByRole('button', { name: 'Save' }).click();
await adm.getByText('Settings saved.').waitFor();
await adm.getByRole('link', { name: 'Donations & Scholarships' }).click();
await adm.getByRole('tab', { name: 'Campaigns' }).click();
await adm.getByRole('button', { name: 'New campaign' }).click();
const title = `Library fund ${stamp}`;
await adm.getByLabel('Title').fill(title);
await adm.getByLabel('Purpose').selectOption('library');
await adm.getByLabel('Goal').fill('500000');
await adm.getByLabel('Summary').fill('New books and reading rooms');
await adm.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
await adm.getByRole('row', { name: new RegExp(title) }).getByRole('button', { name: 'Open' }).click();
await adm.getByText('Updated.').first().waitFor();
ok('finance set bank details and opened a campaign');

const m = await signIn(email);
await m.goto(`${base}/portal/donations`);
await m.getByRole('link', { name: title }).click();
await m.getByRole('button', { name: 'Donate' }).click();
await m.getByRole('button', { name: '5,000', exact: true }).click();
await m.getByLabel('Message (optional)').fill('For the library!');
await m.getByRole('button', { name: /Pledge PKR/ }).click();
await m.getByText('Thank you for your pledge!').waitFor();
await m.getByText('PK36HABB0000001234567890').waitFor();
await shot(m, '01-pledge-instructions');
await m.getByRole('button', { name: 'My donations' }).click();
await m.getByText('Awaiting payment').waitFor();
ok('member pledged and received bank transfer instructions');

await adm.getByRole('tab', { name: 'Donations' }).click();
await adm.getByRole('row', { name: new RegExp(stamp) }).getByRole('button', { name: 'Confirm' }).click();
await adm.getByLabel('Bank / cheque reference').fill('HBL-TRX-1001');
await adm.getByRole('button', { name: 'Confirm and issue receipt' }).click();
await adm.getByText('the receipt was emailed').waitFor();
await shot(adm, '02-donations-admin');
ok('finance confirmed the payment');
await m.reload();
await m.getByRole('button', { name: 'Receipt' }).waitFor();
await m.goto(`${base}/portal/donations`);
await m.getByText('PKR 5,000').first().waitFor();
await m.getByRole('button', { name: /Notifications, \d+ unread/ }).click();
await m.getByText(/Donation received — receipt RC-/).waitFor();
await shot(m, '03-bell');
ok('receipt available; campaign progress and bell notification updated');

// ── newsletters ─────────────────────────────────────────────────────────────
await adm.goto(`${base}/admin/newsletters`);
await adm.getByRole('button', { name: 'New issue' }).click();
await adm.getByLabel('Subject').fill(`Alumni News ${stamp}`);
await adm.getByLabel('Content').fill('# Reunion 2026\n\nJoin us on **12 December** at the campus.\n\n- Dinner\n- Campus tour');
await adm.getByRole('button', { name: 'Preview' }).click();
await adm.frameLocator('iframe[title="Newsletter preview"]').getByText('Reunion 2026').waitFor();
await shot(adm, '04-newsletter-preview');
await adm.getByRole('button', { name: '← Back to editing' }).click();
await adm.getByRole('button', { name: 'Send now' }).click();
await adm.getByRole('dialog').last().getByRole('button', { name: 'Send' }).click();
await adm.getByText('Sending — delivery runs in the background.').waitFor();
ok('newsletter composed, previewed and sent to the queue');

// ── gallery ─────────────────────────────────────────────────────────────────
const img = `${out}/photo.png`;
writeFileSync(img, png());
await adm.goto(`${base}/admin/gallery`);
await adm.getByRole('button', { name: 'New album' }).click();
await adm.getByLabel('Title').fill(`Reunion ${stamp}`);
await adm.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
await adm.getByText('Album saved.').waitFor();
await adm.locator('input[type=file]').setInputFiles([img, img]);
await adm.getByRole('dialog').locator('img').nth(1).waitFor();
await adm.getByRole('button', { name: 'Publish' }).click();
await adm.getByText('Updated.').first().waitFor();
ok('album created with photos and published');
await m.goto(`${base}/portal/gallery`);
await m.getByText(`Reunion ${stamp}`).click();
await m.locator('main img').first().waitFor();
await shot(m, '05-album');
ok('member sees the album');

// notifications page + preferences
await m.goto(`${base}/portal/notifications`);
await m.getByRole('tab', { name: 'Preferences' }).click();
await m.getByText('Alumni newsletter').waitFor();
await shot(m, '06-notification-prefs');

const mob = await signIn(email, PW, { width: 390, height: 844 });
for (const path of ['/portal/donations', '/portal/donations/tab/history', '/portal/gallery', '/portal/notifications']) {
  await mob.goto(`${base}${path}`);
  await mob.waitForLoadState('networkidle');
  const overflow = await mob.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) throw new Error(`${path} overflows by ${overflow}px on mobile`);
}
ok('no horizontal overflow at 390px');

await restore();
await browser.close();
if (errors.length) { console.log('Errors:\n' + errors.join('\n')); process.exit(1); }
console.log('No page errors.');

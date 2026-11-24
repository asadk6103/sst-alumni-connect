// Browser walk-through of Stage 3 community + messaging with the real-time gateway.
//   node scripts/e2e-stage3-community.mjs <appBase> <adminEmail> <adminPassword> <outDir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [base, adminEmail, adminPassword, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const stamp = Date.now().toString(36);
const PW = 'Str0ngPassword!';
const ok = (m) => console.log('✓', m);
// LIVE=1 when the real-time gateway is backed by a real Redis (Docker); otherwise pages are reloaded instead of
// waiting for pushed events (the in-memory Redis used for local runs does not push pub/sub messages).
const LIVE = process.env.LIVE === '1';

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
const batch = (await call('/api/v1/admin/batches', { token: admin })).find((b) => b.name === 'Class of 2014');
async function member(name, email) {
  await call('/api/v1/auth/register', { method: 'POST', body: { full_name: name, email, phone: '+923001234567', password: PW, accept_terms: true,
    graduation_year: 2014, admission_year: 2004, batch_id: batch?.id, city: 'Lahore', country: 'Pakistan' } });
  const row = (await fetch(`${base}/api/v1/admin/alumni?q=${encodeURIComponent(email)}`, { headers: { authorization: `Bearer ${admin}` } }).then((r) => r.json())).data[0];
  await call(`/api/v1/admin/verification/${row.id}/approve`, { token: admin, method: 'POST', body: {} });
  return { id: row.id, email, name, token: await login(email, PW) };
}
const A = await member(`Sara ${stamp}`, `sara-${stamp}@example.org`);
const B = await member(`Omar ${stamp}`, `omar-${stamp}@example.org`);
const req = await call('/api/v1/alumni/connections', { token: A.token, method: 'POST', body: { user_id: B.id } });
await call(`/api/v1/alumni/connections/${req.id}/accept`, { token: B.token, method: 'POST' });
ok('seeded two connected, verified batchmates');

const browser = await chromium.launch();
const errors = [];
async function signIn(who, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(`console(${who.email ?? 'admin'}): ${m.text()}`); });
  page.on('response', async (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()} ${(await r.text().catch(() => '')).slice(0, 200)}`); });
  await page.goto(`${base}/login`);
  await page.getByLabel('Email address').fill(who.email ?? adminEmail);
  await page.getByRole('textbox', { name: 'Password' }).fill(who.email ? PW : adminPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(portal|admin)$/);
  return page;
}
const shot = (p, n) => p.screenshot({ path: `${out}/${n}.png`, fullPage: true });
const pages = [];
const fail = async (e) => {
  for (const [i, p] of pages.entries()) await p.screenshot({ path: `${out}/FAILED-${i}.png`, fullPage: true }).catch(() => {});
  console.log('FAILED:', e.message.split('\n')[0]);
  console.log(errors.join('\n'));
  await restore();
  process.exit(1);
};
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);

const a = await signIn(A); pages.push(a);
const b = await signIn(B); pages.push(b);
await a.getByRole('link', { name: 'Community' }).click();
await b.getByRole('link', { name: 'Community' }).click();
await b.getByText('Community guidelines').waitFor();
await b.waitForTimeout(1500); // feed room subscription
const text = `Who is coming to the reunion? ${stamp}`;
await a.getByLabel('Write a post').fill(text);
await a.getByRole('button', { name: 'Post', exact: true }).click();
await a.getByText(text).waitFor();
if (LIVE) await b.getByRole('button', { name: /1 new post/ }).click({ timeout: 15000 }); else await b.reload();
await b.getByText(text).waitFor();
ok(LIVE ? 'a new post reaches the other member live ("1 new post")' : 'the other member sees the new post');
const card = b.locator('div.rounded-card', { hasText: text }).first();
await card.getByRole('button', { name: 'Like' }).click();
await card.getByRole('button', { name: 'Comment' }).click();
await card.getByLabel('Write a comment').fill('Count me in!');
await card.getByLabel('Write a comment').press('Enter');
await card.getByText('Count me in!').waitFor();
await shot(b, '01-feed-comment');
ok('reaction and comment');
await card.getByRole('button', { name: 'Post options' }).click();
await b.getByRole('menuitem', { name: 'Report' }).click();
await b.getByRole('button', { name: 'Report', exact: true }).click();
await b.getByText('The moderators will review it.').waitFor();
ok('post reported');

await a.goto(`${base}/portal/community/groups`);
await a.getByRole('tab', { name: 'My groups' }).click();
await a.getByText('Class of 2014 community').first().waitFor();
await shot(a, '02-groups');
ok('batch community appears automatically');

// ── messaging ───────────────────────────────────────────────────────────────
await a.goto(`${base}/portal/messages`);
await a.getByRole('button', { name: 'New conversation' }).click();
await a.getByRole('menuitem', { name: 'New message' }).click();
await a.getByRole('dialog').getByRole('button', { name: 'Message' }).first().click();
await a.waitForURL(/\/portal\/messages\/[0-9a-f-]+$/);
const convUrl = a.url();
await b.goto(convUrl);
await b.getByText('Say hello').waitFor();
await b.waitForTimeout(1200);
await a.getByLabel('Message').fill('Salam Omar!');
if (LIVE) { await b.getByText(/typing…/).waitFor({ timeout: 10000 }); ok('typing indicator shown to the other member'); }
await a.getByLabel('Message').press('Enter');
await a.getByLabel('Sent').or(a.getByLabel('Delivered')).or(a.getByLabel('Read')).first().waitFor({ timeout: 10000 });
if (!LIVE) await b.reload();
await b.getByText('Salam Omar!').last().waitFor({ timeout: 10000 });
ok(LIVE ? 'message delivered live over the socket' : 'message sent over the socket and received');
if (!LIVE) { await b.waitForTimeout(1500); await a.reload(); }
await a.getByLabel('Read').first().waitFor({ timeout: 15000 });
ok('read receipt returned to the sender');
await b.getByLabel('Message').fill('Wa alaikum salam! See you there.');
await b.getByLabel('Message').press('Enter');
await b.getByText('See you there.').last().waitFor();
if (!LIVE) await a.reload();
await a.getByText('See you there.').last().waitFor({ timeout: 10000 });
await shot(a, '03-chat');
const m = await signIn(B, { width: 390, height: 844 }); pages.push(m);
await m.goto(convUrl);
await m.getByText('Salam Omar!').last().waitFor();
await shot(m, '04-chat-mobile');
const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
if (overflow > 0) throw new Error(`chat overflows by ${overflow}px on mobile`);
ok('two-way chat; mobile chat view has no overflow');

// ── moderation ──────────────────────────────────────────────────────────────
const adm = await signIn({ email: null }); pages.push(adm);
await adm.getByRole('link', { name: 'Community Moderation' }).click();
await adm.getByText(text).first().waitFor();
await shot(adm, '05-moderation-reports');
await adm.locator('div.rounded-card', { hasText: text }).getByRole('button', { name: 'Hide' }).first().click();
await adm.getByLabel('Reason (optional)').fill('Please use the events page for reunion sign-ups.');
await adm.getByRole('button', { name: 'Confirm' }).click();
await adm.getByText(text).first().waitFor({ state: 'detached' });
await a.goto(`${base}/portal/community`);
await a.getByRole('tab', { name: 'My posts' }).click();
await a.getByText('Hidden by a moderator').waitFor();
await shot(a, '06-hidden-for-author');
ok('moderator hid the reported post; the author sees why');

await restore();
await browser.close();
if (errors.length) { console.log('Errors:\n' + errors.join('\n')); process.exit(1); }
console.log('No page errors.');

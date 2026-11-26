// Redesign phase 4a: Events list (featured, tabs, categories, create) and event detail (RSVP, interested, discussion, attendees, files, agenda).
//   node scripts/e2e-redesign-4a.mjs <appBase> <adminEmail> <adminPassword> <outDir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [base, adminEmail, adminPassword, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const stamp = Date.now().toString(36);
const PW = 'Str0ngPassword!';
const ok = (m) => console.log('✓', m);
async function call(path, { token, method = 'GET', body, form } = {}) {
  const r = await fetch(`${base}${path}`, { method, headers: { ...(form ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
  return j.data;
}
const admin = (await call('/api/v1/auth/login', { method: 'POST', body: { email: adminEmail, password: adminPassword } })).access_token;
const security = await call('/api/v1/admin/config/settings/security', { token: admin });
await call('/api/v1/admin/config/settings/security', { token: admin, method: 'PUT', body: { ...security, require_email_verification: false } });
const email = `evtest-${stamp}@example.org`;
await call('/api/v1/auth/register', { method: 'POST', body: { full_name: `Erum ${stamp}`, email, phone: '+923001234567', password: PW, accept_terms: true, graduation_year: 2012, admission_year: 2002, city: 'Multan', country: 'Pakistan' } });
const row = (await fetch(`${base}/api/v1/admin/alumni?q=${encodeURIComponent(email)}`, { headers: { authorization: `Bearer ${admin}` } }).then((r) => r.json())).data[0];
await call(`/api/v1/admin/verification/${row.id}/approve`, { token: admin, method: 'POST', body: {} });
await call('/api/v1/admin/config/settings/security', { token: admin, method: 'PUT', body: security });
const start = new Date(Date.now() + 9 * 86400000);
const title = `Grand Reunion ${stamp}`;
const ev = await call('/api/v1/admin/events', { token: admin, method: 'POST', body: { title, kind: 'reunion', summary: 'An evening with batchmates.', description: 'Dinner, music and memories.',
  starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 4 * 3600000).toISOString(), venue: 'SST Auditorium', address: 'Rashidabad', max_guests: 1,
  is_featured: true, highlights: ['Dinner & Refreshments', 'Group Photo'], agenda: [{ time: '7:00 PM', title: 'Welcome' }, { time: '8:00 PM', title: 'Dinner' }] } });
await call(`/api/v1/admin/events/${ev.id}/publish`, { token: admin, method: 'POST' });
const fd = new FormData();
fd.append('file', new Blob([Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')], { type: 'application/pdf' }), 'programme.pdf');
await call(`/api/v1/events/${ev.id}/files`, { token: admin, method: 'POST', form: fd });
ok('seeded a member and a featured event with agenda and a file');

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
await p.goto(`${base}/portal/events`);
await p.getByRole('heading', { name: 'Events', exact: true }).waitFor();
await p.getByLabel('Search events').fill(stamp);
await p.getByRole('link', { name: title }).first().waitFor();
await p.locator('[aria-label="Featured events"]').waitFor();
await shot(p, '01-events');
await p.locator('div.rounded-card', { has: p.getByRole('link', { name: title }) }).getByRole('button', { name: 'Interested' }).click();
await p.getByText('Saved to your interested events.').waitFor();
await p.getByRole('tab', { name: 'Interested' }).click();
await p.getByRole('link', { name: title }).first().waitFor();
ok('events list: featured carousel, search, interested tab');

await p.getByRole('link', { name: title }).first().click();
await p.getByRole('heading', { name: title }).waitFor();
await p.getByText('Welcome').waitFor();
await p.getByText('Dinner & Refreshments').waitFor();
await p.getByRole('button', { name: "RSVP – I'm Attending" }).click();
await p.getByRole('button', { name: 'Confirm RSVP' }).click();
await p.getByText('You are registered — your ticket is ready.').waitFor();
await p.getByText('Show this code at the entrance', { exact: false }).waitFor();
await shot(p, '02-event-detail');
ok('event detail: agenda, highlights, RSVP with ticket');

await p.getByRole('tab', { name: /Discussion/ }).click();
await p.getByLabel('Write a comment').fill('Looking forward to it!');
await p.getByRole('button', { name: 'Post', exact: true }).click();
await p.getByText('Looking forward to it!').waitFor();
await p.getByRole('tab', { name: /Attendees \(1\)/ }).click();
await p.getByRole('main').getByText(`Erum ${stamp}`).first().waitFor();
await p.getByRole('tab', { name: 'Files' }).click();
await p.getByText('programme.pdf').waitFor();
ok('discussion, attendees and files tabs');

await p.goto(`${base}/portal/events?create=1`);
await p.getByLabel('Event title').fill(`Hiking trip ${stamp}`);
await p.getByLabel('Category').selectOption('sports');
const local = (x) => new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
await p.getByLabel('Starts').fill(local(new Date(Date.now() + 20 * 86400000)));
await p.getByLabel('Ends').fill(local(new Date(Date.now() + 20 * 86400000 + 5 * 3600000)));
await p.getByLabel('Venue').fill('Margalla Hills');
await p.getByLabel('Add highlight').fill('Breakfast');
await p.getByRole('button', { name: 'Add', exact: true }).click();
await p.getByRole('button', { name: 'Submit for Review' }).click();
await p.getByText('Thanks! The alumni office will review your event.').waitFor();
await p.getByText('Waiting for review').first().waitFor();
ok('member proposed an event (waiting for review)');

const m = await signIn({ width: 390, height: 844 });
for (const path of ['/portal/events', `/portal/events/${ev.id}`]) {
  await m.goto(`${base}${path}`);
  await m.waitForLoadState('networkidle');
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) throw new Error(`${path} overflows by ${overflow}px on mobile`);
}
await shot(m, '03-event-mobile');
ok('no horizontal overflow at 390px');
await browser.close();
if (errors.length) { console.log('Errors:\n' + errors.join('\n')); process.exit(1); }
console.log('No page errors.');

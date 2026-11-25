// Redesign phase 1: login landing → feed, create-post modal (post + poll), reactions, comments with @mention,
// save, global search, invite dialog, mobile layout.
//   node scripts/e2e-redesign-1.mjs <appBase> <adminEmail> <adminPassword> <outDir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [base, adminEmail, adminPassword, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const stamp = Date.now().toString(36);
const ok = (m) => console.log('✓', m);
const browser = await chromium.launch();
const errors = [];
const pages = [];
async function open(viewport = { width: 1536, height: 1000 }) {
  const page = await (await browser.newContext({ viewport })).newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  pages.push(page);
  return page;
}
const shot = (p, n) => p.screenshot({ path: `${out}/${n}.png`, fullPage: false });
const fail = async (e) => {
  for (const [i, p] of pages.entries()) await p.screenshot({ path: `${out}/FAILED-${i}.png`, fullPage: true }).catch(() => {});
  console.log('FAILED:', e.message.split('\n')[0]); console.log(errors.join('\n')); process.exit(1);
};
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);

const p = await open();
await p.goto(`${base}/`);
await p.getByRole('heading', { name: 'Welcome Back' }).waitFor();
await shot(p, '01-login');
ok('login page is the landing page');
await p.getByLabel('Email Address').fill(adminEmail);
await p.getByPlaceholder('Enter your password').fill(adminPassword);
await p.getByRole('button', { name: 'Sign In' }).click();
await p.waitForURL(/\/portal$/);
await p.getByRole('heading', { name: /Good (morning|afternoon|evening)/ }).waitFor();
await p.waitForTimeout(800);
await shot(p, '02-feed');
ok('signed in → feed');

// create a post with a topic and a poll
await p.getByRole('button', { name: /Share an update/ }).click();
const dlg = p.getByRole('dialog');
await dlg.getByRole('heading', { name: 'Create New Post' }).waitFor();
await dlg.getByLabel('Post text').fill(`Reunion planning ${stamp} — who is in?`);
await dlg.getByLabel('Add topics').fill('Reunion');
await dlg.getByLabel('Add topics').press('Enter');
await shot(p, '03-create-post');
await dlg.getByRole('button', { name: 'Post', exact: true }).click();
await p.getByText(`Reunion planning ${stamp}`).first().waitFor();
ok('post created from the modal');

await p.getByRole('button', { name: 'Poll' }).first().click();
await dlg.getByLabel('Poll question').fill(`Best month for the reunion ${stamp}?`);
await dlg.getByLabel('Option 1').fill('December');
await dlg.getByLabel('Option 2').fill('January');
await dlg.getByRole('button', { name: 'Post', exact: true }).click();
const poll = p.locator('div.rounded-card', { hasText: `Best month for the reunion ${stamp}` }).first();
await poll.waitFor();
await poll.getByLabel('December').check();
await poll.getByRole('button', { name: 'Vote' }).click();
await poll.getByText('1 vote').waitFor();
ok('poll created and voted');

// reactions, comment, save
const card = p.locator('article, div').filter({ hasText: `Reunion planning ${stamp}` }).locator('xpath=ancestor-or-self::div[contains(@class,"rounded-card")]').first();
await card.getByRole('button', { name: 'Like' }).first().click();
await card.getByRole('button', { name: 'Comment' }).click();
await card.getByLabel('Write a comment').fill('Count me in!');
await card.getByLabel('Send comment').click();
await card.getByText('Count me in!').waitFor();
await card.getByRole('button', { name: 'Save', exact: true }).click();
await p.waitForTimeout(400);
await shot(p, '04-post-interactions');
ok('reacted, commented and saved');

await p.goto(`${base}/portal/saved`);
await p.getByText(`Reunion planning ${stamp}`).waitFor();
ok('saved posts page lists the post');

// global search
await p.getByLabel('Search the portal').fill('Reunion');
await p.getByText('Posts', { exact: true }).waitFor();
await shot(p, '05-search');
ok('global search shows results');
await p.keyboard.press('Escape');

// invite dialog
await p.goto(`${base}/portal`);
await p.getByRole('button', { name: 'Invite Alumni' }).first().click();
await p.getByLabel('Email addresses').fill(`friend-${stamp}@example.org`);
await p.getByText('1 address found.').waitFor();
await p.getByRole('dialog').getByRole('button', { name: /Send 1 invitation/ }).click();
await p.getByText(/Invitations sent/).waitFor();
ok('invitation sent');

// mobile
const m = await open({ width: 390, height: 844 });
await m.goto(`${base}/`);
await m.getByRole('heading', { name: 'Welcome Back' }).waitFor();
for (const path of ['/']) {
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) throw new Error(`${path} overflows by ${overflow}px`);
}
await shot(m, '06-login-mobile');
await m.getByLabel('Email Address').fill(adminEmail);
await m.getByPlaceholder('Enter your password').fill(adminPassword);
await m.getByRole('button', { name: 'Sign In' }).click();
await m.waitForURL(/\/portal$/);
for (const path of ['/portal', '/portal/saved']) {
  await m.goto(`${base}${path}`);
  await m.waitForLoadState('networkidle');
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) throw new Error(`${path} overflows by ${overflow}px on mobile`);
}
await m.goto(`${base}/portal`);
await m.waitForTimeout(600);
await shot(m, '07-feed-mobile');
ok('no horizontal overflow at 390px');

await browser.close();
if (errors.length) { console.log('Errors:\n' + errors.join('\n')); process.exit(1); }
console.log('No page errors.');

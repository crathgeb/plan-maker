// Do it for me: a guide section handed to a new Claude session in Terminal, with Claude in Chrome.
// The button shows only where it can work; the session ticks steps off and the page follows.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromeInstalled, doItAvailable, readSection } from '../lib/doit.mjs';
import { launch, newPage, open, repo, startServer } from './helpers.mjs';

const temp = (name) => realpathSync(mkdtempSync(join(tmpdir(), name)));
const home = temp('plan-maker-home-');
const proj = temp('plan-maker-doit-');
mkdirSync(join(proj, '.git'));
const opened = join(proj, 'opened.txt');
const openBin = join(proj, 'open-stand-in');
writeFileSync(openBin, `#!/bin/sh\necho "$1" >> '${opened}'\n`);
chmodSync(openBin, 0o755);
Object.assign(process.env, { PLAN_MAKER_HOME: home, PLAN_MAKER_SCAN: 'off', PLAN_MAKER_OPEN_BIN: openBin, PLAN_MAKER_CLAUDE_BIN: '/usr/bin/true' });

function pageAt(slug, template) {
  const dir = join(proj, 'guides', slug);
  mkdirSync(dir, { recursive: true });
  const page = join(dir, 'index.html');
  copyFileSync(join(repo, 'templates', template), page);
  return page;
}
const guide = pageAt('dns', 'guide.html');
const plan = pageAt('plan', 'plan.html');

let browser;
const servers = [];
async function serve(page, doit) {
  process.env.PLAN_MAKER_DOIT = doit;
  const s = await startServer(page);
  servers.push(s);
  return s;
}
before(async () => (browser = await launch()));
after(async () => {
  for (const s of servers) s.stop();
  await browser?.close();
});

test('the section and its steps, read from the page', () => {
  const s = readSection(readFileSync(guide, 'utf8'), 'records');
  assert.equal(s.title, 'Add the records');
  assert.deepEqual(s.steps.map((x) => x.id), ['g-records-ready', 'g-open-dns', 'g-cname', 'g-verify-txt']);
  assert.equal(readSection(readFileSync(guide, 'utf8'), 'nope'), null);
});

test('available only with Claude in Chrome installed (or turned on or off by hand)', () => {
  const cfg = join(proj, 'claude.json');
  writeFileSync(cfg, JSON.stringify({ cachedChromeExtensionInstalled: false }));
  assert.equal(chromeInstalled({ PLAN_MAKER_CLAUDE_JSON: cfg }), false);
  writeFileSync(cfg, JSON.stringify({ cachedChromeExtensionInstalled: true }));
  assert.equal(chromeInstalled({ PLAN_MAKER_CLAUDE_JSON: cfg }), true);
  assert.equal(doItAvailable({ PLAN_MAKER_DOIT: 'off' }).available, false);
  assert.equal(doItAvailable({ PLAN_MAKER_DOIT: 'on' }).available, true);
});

test('Do it for me opens Terminal with Claude on that section; ticks from the session show at once', async () => {
  const s = await serve(guide, 'on');
  const errors = [];
  const page = await newPage(browser, errors);
  await open(page, s.url);
  const btn = page.locator('section[data-id="records"] > .pm-doit');
  await btn.waitFor({ state: 'visible' });
  // Every section with steps has one; a section without steps doesn't.
  assert.equal(await page.locator('section[data-id="check"] > .pm-doit').isVisible(), true);
  assert.equal(await page.locator('section[data-id="trouble"] > .pm-doit').count(), 0);
  // Top right of the section.
  const [b, sec] = await Promise.all([btn.boundingBox(), page.locator('section[data-id="records"]').boundingBox()]);
  assert.ok(b.x + b.width > sec.x + sec.width - 40 && b.y < sec.y + 40, `not top right: ${JSON.stringify({ b, sec })}`);

  await btn.click();
  await page.waitForSelector('section[data-id="records"] > .pm-doit[data-s="started"]');
  const script = readFileSync(opened, 'utf8').trim();
  assert.match(script, /\.command$/);
  const text = readFileSync(script, 'utf8');
  assert.match(text, /'--chrome'/);
  assert.match(text, /'--remote-control'/);
  assert.ok(text.includes(`cd '${proj}'`), text);
  assert.doesNotMatch(text, /dangerously/);
  const prompt = readFileSync(script.replace(/\.command$/, '.prompt.md'), 'utf8');
  assert.match(prompt, /"Add the records"/);
  assert.match(prompt, /g-records-ready.*already done, skip it/);
  assert.match(prompt, /g-cname/);
  assert.ok(prompt.includes(join(repo, 'scripts/step.mjs')));
  // Pressing it again within the minute doesn't start a second one.
  const again = await page.evaluate(() => fetch('/api/doit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"section":"records"}' }).then((r) => r.status));
  assert.equal(again, 409);
  errors.length = 0; // that refusal was the point

  // The session ticks steps off through the page's server: the open page shows it without a reload.
  const step = (...a) => execFileSync(process.execPath, [join(repo, 'scripts/step.mjs'), guide, ...a], { encoding: 'utf8' });
  assert.match(step('done', 'g-open-dns', '--note', 'opened Cloudflare'), /ticked “Open the DNS settings/);
  await page.waitForSelector('[data-id="g-open-dns"] .pm-done-btn.pm-on');
  assert.equal(await page.locator('[data-id="g-open-dns"] .pm-done-btn').textContent(), 'Done by Claude');
  const notes = JSON.parse(readFileSync(join(guide, '../notes.json'), 'utf8'));
  assert.equal(notes.steps['g-open-dns'].by, 'claude');
  assert.equal(notes.steps['g-open-dns'].note, 'opened Cloudflare');
  assert.match(step('show'), /\[x\] g-open-dns/);

  // Once every step is done, the section's button goes.
  step('done', 'g-cname');
  step('done', 'g-verify-txt');
  await page.locator('section[data-id="records"] > .pm-doit').waitFor({ state: 'hidden' });
  // The tab's own next save keeps the ticks.
  await page.locator('[data-id="g-dig"] .pm-done-btn').click();
  await page.waitForFunction(() => document.querySelector('#pm-status')?.textContent.match(/Saved/));
  const after = JSON.parse(readFileSync(join(guide, '../notes.json'), 'utf8'));
  assert.ok(after.steps['g-cname']?.done && after.steps['g-dig']?.done);
  assert.deepEqual(errors, []);
  await page.close();
});

test('no button without Claude in Chrome, and none on a plan', async () => {
  const off = await serve(pageAt('dns-off', 'guide.html'), 'off');
  const errors = [];
  const page = await newPage(browser, errors);
  await open(page, off.url);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.pm-doit:visible').count(), 0);
  const p = await serve(plan, 'on');
  await open(page, p.url);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.pm-doit').count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('step.mjs without a server writes notes.json itself', () => {
  for (const s of servers) s.stop();
  const solo = pageAt('solo', 'guide.html');
  const out = execFileSync(process.execPath, [join(repo, 'scripts/step.mjs'), solo, 'done', 'g-dig'], { encoding: 'utf8', env: process.env });
  assert.match(out, /in notes\.json/);
  assert.ok(existsSync(join(solo, '../notes.json')));
  assert.equal(JSON.parse(readFileSync(join(solo, '../notes.json'), 'utf8')).steps['g-dig'].by, 'claude');
});

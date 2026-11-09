// The registry CLI and the hub: registering pages, each owner's lane of steps,
// what's waiting on you, and the hub page with projects in its sidebar.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { launch, newPage, repo } from './helpers.mjs';

// macOS: /var → /private/var, as process.cwd() reports it.
const temp = (name) => realpathSync(mkdtempSync(join(tmpdir(), name)));
const home = temp('plan-maker-home-');
const proj = temp('plan-maker-proj-');
const proj2 = temp('plan-maker-proj2-');
const env = { ...process.env, PLAN_MAKER_HOME: home, PLAN_MAKER_HOST: '', PLAN_MAKER_TRUST: '' };

const page = ({ title, lede, version = 1, body, guide = false }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
${guide ? '<meta name="pm-kind" content="guide">\n' : ''}<meta name="plan-version" content="${version}">
<title>${title}</title></head>
<body><main data-plan>
<header class="hero" data-id="hero"><h1>${title}</h1><p class="lede">${lede}</p></header>
${body}
<section class="sec" data-id="glossary"><h2>Glossary</h2><p class="lede">Terms you asked about.</p></section>
</main></body></html>`;

// One plan, both owners: data-who on every step, Claude's status in data-status.
const UNIFIED = page({
  title: 'Docs Site Migration',
  lede: 'Move the docs to a static site built from the repo.',
  version: 2,
  body: `<section class="sec" data-id="rollout"><h2>Rollout</h2>
  <div class="steps">
    <div class="step" data-id="s1" data-who="you"><h3>Create the Cloudflare account</h3></div>
    <div class="step" data-id="s2" data-who="claude" data-status="done"><h3>Convert the 60 pages</h3></div>
    <div class="step" data-id="s3" data-who="claude" data-status="doing"><h3>Generate redirects</h3></div>
    <div class="step item" data-id="s4" data-who="both"><h3>Check the preview <span class="who both">Both</span></h3></div>
    <div class="step" data-id="s5" data-who="you"><h3>Point DNS at Cloudflare</h3></div>
    <div class="step" data-id="s6" data-who="claude"><h3>Retire the CMS</h3></div>
  </div></section>
  <section class="sec" data-id="decisions"><h2>Decisions for you</h2>
    <div class="decision" data-decision="gen" data-id="d-gen"><h3>Which generator?</h3>
      <label><input type="radio" name="gen" value="astro"><b>Astro</b><span class="rec">Recommended</span></label>
      <label><input type="radio" name="gen" value="docusaurus"><b>Docusaurus</b></label></div>
  </section>`,
});

// A page written as a guide before plans and guides merged: owners only in .who tags.
const OLD_GUIDE = page({
  title: 'Deploy a Static Site',
  lede: 'Build the site, check it, publish it.',
  guide: true,
  body: `<section class="sec" data-id="build"><h2>Build</h2><div class="steps">
    <div class="step" data-id="s1-install"><div class="num">1</div><h4>Install the tool <span class="who you">You</span></h4></div>
    <div class="step" data-id="s2-build"><div class="num">2</div><h4>Build the site <span class="who claude">Claude</span></h4></div>
    <div class="step" data-id="s3-deploy"><div class="num">3</div><h4>Publish <span class="who both">Both</span></h4></div>
  </div></section>`,
});

// Only Claude's steps: never waiting on you once it's in progress.
const CLAUDE_ONLY = page({
  title: 'Search Console Report',
  lede: 'A weekly report Claude writes on its own.',
  body: `<div class="steps"><div class="step" data-id="c1" data-who="claude" data-status="doing"><h3>Pull the numbers</h3></div></div>`,
});

function put(dir, rel, html) {
  mkdirSync(join(dir, rel), { recursive: true });
  writeFileSync(join(dir, rel, 'index.html'), html);
}
mkdirSync(join(proj, '.git'));
mkdirSync(join(proj2, '.git'));
put(proj, 'plans/docs', UNIFIED);
put(proj, 'guides/deploy', OLD_GUIDE);
put(proj, 'plans/report', CLAUDE_ONLY);
put(proj, 'marketing/plan', page({ title: 'Marketing', lede: 'Elsewhere in the tree.', body: '' }));
mkdirSync(join(proj, 'marketing/plan/versions'));
writeFileSync(join(proj, 'marketing/plan/versions/v1.html'), UNIFIED); // a snapshot, not a plan
put(proj, 'node_modules/pkg', UNIFIED); // dependencies are skipped
writeFileSync(join(proj, 'marketing/page.html'), '<!doctype html><title>Not a plan</title>');
put(proj2, 'plans/coffer', page({ title: 'Coffer Build Plan', lede: 'A macOS app that keeps your API keys.', body: '' }));

const cli = (...args) => spawnSync(process.execPath, [join(repo, 'scripts/registry.mjs'), ...args], { cwd: proj, env, encoding: 'utf8' });
const registry = () => JSON.parse(readFileSync(join(home, 'registry.json'), 'utf8'));
const entry = (name) => registry().entries.find((e) => e.name === name);
const show = (idOrPath) => JSON.parse(cli('show', idOrPath).stdout);
const notes = (rel, obj) => writeFileSync(join(proj, rel, 'notes.json'), JSON.stringify(obj));
const children = [];

function http(url, path, { method = 'GET', body } = {}) {
  const { port } = new URL(url);
  return new Promise((ok, bad) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: body ? { 'content-type': 'application/json' } : {} }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', bad);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

function startHub() {
  const port = 4300 + Math.floor(Math.random() * 100);
  const proc = spawn(process.execPath, [join(repo, 'scripts/hub.mjs'), '--no-open', '--port', String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(proc);
  let out = '';
  return new Promise((ok, bad) => {
    const timer = setTimeout(() => bad(new Error('hub did not start:\n' + out)), 5000);
    const onData = (d) => {
      out += d;
      const m = out.match(/open\s+→\s+(http:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        ok(m[1]);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
  });
}

after(() => {
  for (const c of children) c.kill();
  // Review servers the hub started run detached, so they outlive the hub: stop them by their arguments.
  spawnSync('pkill', ['-f', `review.mjs ${proj}`]);
  for (const d of [home, proj, proj2]) rmSync(d, { recursive: true, force: true });
});

describe('registry CLI', () => {
  test('scan registers every plan-maker page, skipping snapshots and dependencies', () => {
    const r = cli('scan');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /4 pages found, 4 newly registered/);
    assert.ok(entry('Marketing'));
    assert.equal(cli('remove', 'marketing/plan').status, 0);
    assert.match(cli('scan', 'plans').stdout, /2 pages found, 0 newly registered/);
    const add = spawnSync(process.execPath, [join(repo, 'scripts/registry.mjs'), 'add', 'plans/coffer'], { cwd: proj2, env, encoding: 'utf8' });
    assert.equal(add.status, 0, add.stderr);
  });

  test('entries take their name and description from the page, with no kind', () => {
    const docs = entry('Docs Site Migration');
    assert.equal(docs.status, 'reviewing');
    assert.equal(docs.description, 'Move the docs to a static site built from the repo.'); // the hero's lede, not the glossary's
    assert.equal('kind' in docs, false);
    assert.equal(entry('Deploy a Static Site').status, 'in-progress'); // written as a guide: followed, not reviewed
    assert.equal(entry('Coffer Build Plan').project, proj2.split('/').pop());
  });

  test('lanes count your steps from notes.json and Claude’s from data-status', () => {
    notes('plans/docs', { steps: { s1: { done: true }, s2: { done: true } } }); // s2 is Claude's: ticking it means nothing
    const d = show('plans/docs');
    assert.deepEqual(d.lanes, { you: { done: 1, total: 3 }, claude: { done: 1, total: 3, doing: 1 } });
    assert.equal(d.nextYouStep, 'Check the preview'); // the .who tag's text is not part of the title
    assert.equal(d.version, 2);
    assert.equal(d.openDecisions, 1);
  });

  test('a page written as a guide still works through its .who tags', () => {
    notes('guides/deploy', { kind: 'guide', steps: { 's1-install': { done: true } }, items: { 's3-deploy': { note: 'which host?', kind: 'question' } } });
    const g = show('guides/deploy');
    assert.deepEqual(g.lanes, { you: { done: 1, total: 2 }, claude: { done: 0, total: 1, doing: 0 } });
    assert.equal(g.nextYouStep, 'Publish');
    assert.equal(g.questions, 1);
    assert.deepEqual(g.waiting.map((w) => w.text), ['1 of your steps left: Publish']);
  });

  test('waiting reasons follow the status, the review and your steps', () => {
    const reasons = () => show('plans/docs').waiting.map((w) => w.key);
    assert.deepEqual(reasons(), ['review', 'decisions']);
    assert.deepEqual(show('plans/docs').waiting.map((w) => w.text), ['Review the plan', 'Answer 1 decision']);
    notes('plans/docs', { doneAt: '2026-11-08T10:00:00Z', items: { s5: { verdict: 'change', note: 'week 4' } }, steps: { s1: { done: true } } });
    assert.deepEqual(reasons(), ['decisions', 'process']);
    cli('update', 'plans/docs', '--status', 'in-progress');
    assert.deepEqual(reasons(), ['process', 'steps']);
    assert.equal(show('plans/docs').waiting.at(-1).text, '2 of your steps left: Check the preview');
    cli('update', 'plans/docs', '--status', 'blocked', '--next', 'You: ask IT for DNS access');
    assert.deepEqual(show('plans/docs').waiting.map((w) => w.text), ['Tell Claude “process my notes”', 'You: ask IT for DNS access']);
    cli('update', 'plans/docs', '--next', 'Waiting on IT');
    assert.deepEqual(reasons(), ['process']);
    cli('update', 'plans/docs', '--status', 'done');
    assert.deepEqual(reasons(), []);
    // Back to a plan that waits on your steps only, for the hub tests.
    notes('plans/docs', { steps: { s1: { done: true } } });
    cli('update', 'plans/docs', '--status', 'in-progress', '--next', 'You: check the preview');
    cli('update', 'plans/report', '--status', 'in-progress');
    assert.deepEqual(show('plans/report').waiting, []);
  });

  test('update logs status changes and progress lines; bad statuses are refused', () => {
    const docs = entry('Docs Site Migration');
    assert.deepEqual(docs.log.map((l) => l.text), ['Status → in-progress', 'Status → blocked', 'Status → done', 'Status → in-progress']);
    assert.equal(cli('update', 'plans/docs', '--log', 'Phase 1 done').status, 0);
    assert.equal(entry('Docs Site Migration').log.at(-1).text, 'Phase 1 done');
    const r = cli('update', 'plans/docs', '--status', 'finished');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /status must be one of/);
  });

  test('list groups by project, waiting plans first, with lanes and reasons', () => {
    const out = cli('list').stdout;
    const p1 = proj.split('/').pop(), p2 = proj2.split('/').pop();
    assert.match(out, new RegExp(`${p1} \\(3, 2 waiting on you\\)`));
    assert.match(out, new RegExp(`${p2} \\(1, 1 waiting on you\\)`));
    assert.match(out, /Docs Site Migration {2}\(in-progress\) {2}v2 · you 1\/3 · claude 1\/3 \(1 in progress\) · 1 open decision/);
    assert.match(out, /waiting on you: 2 of your steps left: Check the preview/);
    // Within a project, the plan that isn't waiting comes last.
    const section = out.slice(out.indexOf(`${p1} (`));
    assert.ok(section.indexOf('Search Console Report') > section.indexOf('Docs Site Migration'));
    cli('update', 'plans/report', '--status', 'done');
    assert.doesNotMatch(cli('list').stdout, /Search Console Report/);
    assert.match(cli('list', '--all').stdout, /Search Console Report/);
    cli('update', 'plans/report', '--status', 'in-progress');
  });
});

describe('hub', () => {
  let url, browser;
  before(async () => {
    // The plan that isn't waiting is the most recently touched: it must still sort below the waiting ones.
    const t = new Date(Date.now() + 60_000);
    utimesSync(join(proj, 'plans/report/index.html'), t, t);
    url = await startHub();
    browser = await launch();
  });
  after(() => browser?.close());

  test('lists every entry with lanes and waiting reasons', async () => {
    const { status, body } = await http(url, '/api/entries');
    assert.equal(status, 200);
    const { entries } = JSON.parse(body);
    assert.equal(entries.length, 4);
    const docs = entries.find((e) => e.name === 'Docs Site Migration');
    assert.deepEqual(docs.lanes.you, { done: 1, total: 3 });
    assert.equal(docs.waiting[0].key, 'steps');
    assert.equal(entries.some((e) => 'kind' in e), false);
  });

  test('a second start reuses the running hub', async () => {
    const r = spawnSync(process.execPath, [join(repo, 'scripts/hub.mjs'), '--no-open', '--port', new URL(url).port], { env, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /already running/);
  });

  test('refuses requests addressed by another name', async () => {
    const { port } = new URL(url);
    const status = await new Promise((ok) => {
      request({ host: '127.0.0.1', port, path: '/api/entries', headers: { host: `evil.example:${port}` } }, (res) => ok(res.statusCode)).end();
    });
    assert.equal(status, 403);
  });

  test('PATCH changes status and appends a log line', async () => {
    const id = entry('Coffer Build Plan').id;
    const r = await http(url, `/api/entries/${id}`, { method: 'PATCH', body: { status: 'approved', log: 'Decisions settled' } });
    assert.equal(r.status, 200);
    const e = JSON.parse(r.body);
    assert.equal(e.status, 'approved');
    assert.equal(e.log.at(-1).text, 'Decisions settled');
    assert.equal((await http(url, `/api/entries/${id}`, { method: 'PATCH', body: { status: 'nope' } })).status, 400);
    await http(url, `/api/entries/${id}`, { method: 'PATCH', body: { status: 'reviewing' } });
  });

  test('/open starts the review server and redirects to it', async () => {
    const id = entry('Docs Site Migration').id;
    const r = await http(url, `/open/${id}`);
    assert.equal(r.status, 302);
    assert.match(r.headers.location, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const p = await http(r.headers.location, '/');
    assert.equal(p.status, 200);
    assert.match(p.body, /Docs Site Migration/);
    assert.equal((await http(url, `/open/${id}`)).headers.location, r.headers.location); // reused
  });

  test('the page: projects in the sidebar, waiting plans first, a plan’s detail, status and hash', async () => {
    const errors = [];
    const pg = await newPage(browser, errors);
    await pg.goto(url);
    await pg.waitForSelector('#projects .row');
    const p1 = proj.split('/').pop(), p2 = proj2.split('/').pop();
    const groups = await pg.$$eval('#projects .project', (els) => els.map((s) => ({ name: s.querySelector('.grp-name').textContent.trim(), plans: [...s.querySelectorAll('.row .name')].map((n) => n.textContent) })));
    assert.deepEqual(groups.map((g) => g.name).sort(), [p1, p2].sort());
    const mine = groups.find((g) => g.name === p1).plans;
    assert.equal(mine.length, 3);
    assert.equal(mine.at(-1), 'Search Console Report'); // the newest, but not waiting on you
    // With nothing selected, the main area lists what's waiting, grouped by project.
    assert.equal(await pg.textContent('#sheet h1'), 'Waiting on you');
    assert.match(await pg.textContent('#sheet'), /2 of your steps left: Check the preview/);
    assert.match(await pg.textContent('#sheet'), /Review the plan/);
    assert.equal(await pg.textContent('#wcount'), '3'); // docs: steps · the old guide: steps · coffer: review
    // The hub wears the plan template's own styles.
    assert.equal(await pg.evaluate(() => getComputedStyle(document.querySelector('#sheet .hero')).borderTopLeftRadius), '12px');
    // Selecting a plan shows the plan itself, live, in a frame: no bar of the hub's own.
    await pg.click('#projects .row:has-text("Docs Site Migration")');
    assert.equal(await pg.getAttribute('#projects .row:has-text("Docs Site Migration")', 'aria-current'), 'true');
    assert.equal(await pg.locator('#sheet .embed-bar, #sheet h1').count(), 0);
    let frame = pg.frameLocator('#sheet .plan-frame');
    await frame.locator('html[data-pm-ready]').waitFor();
    // The plan's own top bar carries its name and status (from the registry).
    assert.equal(await frame.locator('.pm-title-name').textContent(), 'Docs Site Migration');
    await frame.locator('.pm-status:not([hidden])').waitFor();
    assert.equal(await frame.locator('#pm-status-sel').inputValue(), 'in-progress');
    // A refresh keeps the same frame: it isn't reloaded under the reader.
    await pg.evaluate(() => (document.querySelector('.plan-frame').dataset.mark = '1'));
    await pg.evaluate(() => window.dispatchEvent(new Event('hashchange')));
    assert.equal(await pg.getAttribute('#sheet .plan-frame', 'data-mark'), '1');
    // Changing the status inside the plan saves it, and the hub's sidebar follows straight away.
    await frame.locator('#pm-status-sel').selectOption('blocked');
    await pg.waitForFunction(() => document.querySelector('#projects .row[aria-current="true"] .dot')?.dataset.s === 'blocked');
    assert.equal(entry('Docs Site Migration').status, 'blocked');
    // The selection survives a reload.
    await pg.reload();
    await pg.waitForSelector('#sheet .plan-frame');
    assert.equal(await pg.getAttribute('#projects .row:has-text("Docs Site Migration")', 'aria-current'), 'true');
    // The sidebar collapses to a rail and remembers it.
    await pg.click('#side-collapse');
    assert.equal(await pg.isVisible('#projects'), false);
    assert.equal(await pg.isVisible('#wcount'), true);
    await pg.reload();
    await pg.waitForSelector('#sheet .plan-frame');
    assert.equal(await pg.isVisible('#projects'), false);
    await pg.click('#side-collapse');
    assert.equal(await pg.isVisible('#projects'), true);
    // A waiting card opens its plan here.
    await pg.click('.waiting-all');
    await pg.click('.w-plan:has-text("Coffer Build Plan") .open-here');
    assert.equal(await pg.getAttribute('#projects .row:has-text("Coffer Build Plan")', 'aria-current'), 'true');
    frame = pg.frameLocator('#sheet .plan-frame');
    await frame.locator('html[data-pm-ready]').waitFor();
    // Phone width: no horizontal scroll, and the sidebar folds behind a toggle.
    await pg.setViewportSize({ width: 390, height: 800 });
    assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await pg.isVisible('#projects'), false);
    await pg.click('#side-toggle');
    assert.equal(await pg.isVisible('#projects'), true);
    assert.deepEqual(errors, []);
  });
});

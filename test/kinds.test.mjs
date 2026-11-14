// Plans, guides and references, end to end in Chrome: each kind's page, phases and their
// guides, Make a guide and More detail, the way between a guide and its plan, staleness.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { launch, newPage, open, readNotes, repo, selectText, startServer, waitForNotes } from './helpers.mjs';

// Review servers read the registry, and /api/open logs under PLAN_MAKER_HOME: keep both out of ~.
const home = realpathSync(mkdtempSync(join(tmpdir(), 'plan-maker-home-')));
process.env.PLAN_MAKER_HOME = home;
process.env.PLAN_MAKER_HOST = '';

// A project with a plan, the guide made from its switch-over phase, and a reference.
const proj = realpathSync(mkdtempSync(join(tmpdir(), 'plan-maker-kinds-')));
mkdirSync(join(proj, '.git'));
const plan = join(proj, 'plans/docs/index.html');
const guide = join(proj, 'plans/docs/guides/dns-cutover/index.html');
const ref = join(proj, 'docs/reference/index.html');
mkdirSync(join(proj, 'plans/docs/guides/dns-cutover'), { recursive: true });
mkdirSync(join(proj, 'docs/reference'), { recursive: true });
copyFileSync(join(repo, 'templates/plan.html'), plan);
copyFileSync(join(repo, 'templates/guide.html'), guide);
copyFileSync(join(repo, 'templates/reference.html'), ref);
for (const f of ['build.mjs', 'site.config.json', 'redirects.json']) writeFileSync(join(proj, 'docs', f), '{}');
// The reference was written after its sources: current.
const past = new Date(Date.now() - 3600e3);
for (const f of ['build.mjs', 'site.config.json', 'redirects.json']) utimesSync(join(proj, 'docs', f), past, past);

const cli = (...args) => spawnSync(process.execPath, [join(repo, 'scripts/registry.mjs'), ...args], { cwd: proj, env: process.env, encoding: 'utf8' });
const show = (p) => JSON.parse(cli('show', p).stdout);

let browser;
const errors = [];
const servers = [];
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
  for (const s of servers) s.stop();
  // Servers started by /api/open run detached: stop them by their arguments.
  spawnSync('pkill', ['-f', `review.mjs ${proj}`]);
  rmSync(proj, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});
const serve = async (page) => {
  const s = await startServer(page);
  servers.push(s);
  return s;
};

test('the three templates share one style block, word for word', () => {
  const style = (f) => readFileSync(join(repo, 'templates', f), 'utf8').match(/^<style>$[\s\S]*?^<\/style>$/m)[0];
  assert.ok(style('plan.html').length > 10000);
  assert.equal(style('guide.html'), style('plan.html'));
  assert.equal(style('reference.html'), style('plan.html'));
  for (const [f, kind] of [['plan.html', 'plan'], ['guide.html', 'guide'], ['reference.html', 'reference']]) {
    assert.match(readFileSync(join(repo, 'templates', f), 'utf8'), new RegExp(`<meta name="pm-kind" content="${kind}">`));
  }
});

describe('a plan: phases, a linked guide, Make a guide, More detail', () => {
  let server, page;
  before(async () => {
    cli('add', plan, '--goal', 'Docs ship with the code');
    cli('add', guide, '--goal', 'Switch the domain');
    // Two of the guide's steps already done.
    writeFileSync(join(proj, 'plans/docs/guides/dns-cutover/notes.json'), JSON.stringify({ version: 1, planVersion: '1', steps: { 'g-open-dns': { done: true }, 'g-cname': { done: true } } }));
    server = await serve(plan);
    page = await newPage(browser, errors);
    await open(page, server.url);
  });

  test('the top bar says Plan; progress counts phases', async () => {
    assert.equal(await page.locator('#pm-top .pm-kind').textContent(), 'Plan');
    assert.equal(await page.getAttribute('html', 'data-pm-kind'), 'plan');
    assert.equal(await page.locator('#pm-prog .pm-prog-txt').textContent(), '0 of 4 phases done');
    assert.equal(await page.locator('#pm-prog').getAttribute('data-you'), '0/2');
    assert.equal(await page.locator('#pm-prog').getAttribute('data-claude'), '0/2');
    // the plan's statuses, not a guide's
    const opts = await page.locator('#pm-status-sel option:not([disabled]):not([value="pm-remove"])').evaluateAll((o) => o.map((x) => x.value));
    assert.deepEqual(opts, ['draft', 'reviewing', 'approved', 'in-progress', 'blocked', 'done', 'archived']);
  });

  test('each phase gets the controls its owner needs', async () => {
    const ph = (id) => page.locator(`[data-id="${id}"]`);
    assert.equal(await ph('ph-scaffold').locator('.pm-status-tag').textContent(), 'In progress');
    assert.equal(await ph('ph-scaffold').locator('.pm-done-btn[data-who="claude"]').count(), 1); // the reader can close Claude's phase
    assert.equal(await ph('ph-review').locator('.pm-done-btn').count(), 1);
    assert.equal(await ph('ph-review').locator('.pm-guide-btn').count(), 1);
    assert.equal(await ph('ph-review').locator('.pm-detail-btn').count(), 1);
    // the switch-over is done through its guide: a link with the guide's progress, no Mark done, no Make a guide
    assert.equal(await ph('ph-switch').locator('.pm-done-btn').count(), 0);
    assert.equal(await ph('ph-switch').locator('.pm-guide-btn').count(), 0);
    assert.equal(await ph('ph-switch').locator('.pm-guide-name').textContent(), 'Switch the docs domain');
    assert.equal(await ph('ph-switch').locator('.pm-guide-prog').textContent(), '3 of 7 steps done');
    // plain blocks get Comment and More detail, never Make a guide
    assert.equal(await page.locator('[data-id="sum-goal"] .pm-detail-btn').count(), 1);
    assert.equal(await page.locator('[data-id="sum-goal"] .pm-guide-btn').count(), 0);
  });

  test('Make a guide saves a request with no words needed, and the registry sees it', async () => {
    await page.hover('[data-id="ph-review"]');
    await page.click('[data-id="ph-review"] .pm-guide-btn');
    const notes = await waitForNotes(join(proj, 'plans/docs/notes.json'), (n) => n.items?.['ph-review']?.kind === 'guide');
    assert.equal(notes.items['ph-review'].note, '');
    assert.equal(await page.locator('[data-id="ph-review"] .pm-note-btn').textContent(), 'Guide requested');
    assert.equal(await page.locator('[data-id="ph-review"] .pm-guide-btn').isHidden(), true);
    // the panel offers Make a guide on a phase
    const kinds = await page.locator('.pm-note[data-key="i:ph-review"] .pm-kinds button').allTextContents();
    assert.deepEqual(kinds, ['Comment', 'Question', 'More detail', 'Make a guide']);
    assert.match(await page.locator('#pm-summary').textContent(), /1 guide requested/);
    const d = show(plan);
    assert.equal(d.requests.guide, 1);
    assert.ok(d.waiting.some((w) => /process my notes.*1 guide/.test(w.text)), JSON.stringify(d.waiting));
  });

  test('deleting the request clears it', async () => {
    await page.click('.pm-note[data-key="i:ph-review"] .pm-del');
    await waitForNotes(join(proj, 'plans/docs/notes.json'), (n) => !n.items['ph-review'].kind);
    assert.equal(await page.locator('[data-id="ph-review"] .pm-note-btn').textContent(), 'Comment');
    assert.equal(show(plan).requests.guide, 0);
  });

  test('More detail on selected text saves a highlight that asks for it', async () => {
    await selectText(page, 'ap-redirects', 0, 25);
    await page.click('#pm-pop button[data-kind="detail"]');
    const notes = await waitForNotes(join(proj, 'plans/docs/notes.json'), (n) => n.highlights?.some((h) => h.kind === 'detail'));
    const h = notes.highlights.find((x) => x.kind === 'detail');
    assert.equal(h.quote, 'Every old URL keeps worki');
    assert.equal(show(plan).requests.detail, 1);
    // a block's More detail too
    await page.hover('[data-id="ctx-stale"]');
    await page.click('[data-id="ctx-stale"] .pm-detail-btn');
    await waitForNotes(join(proj, 'plans/docs/notes.json'), (n) => n.items?.['ctx-stale']?.kind === 'detail');
    assert.equal(await page.locator('[data-id="ctx-stale"] .pm-note-btn').textContent(), 'More detail asked');
  });

  test('the phase follows its guide: done when every step is', async () => {
    const steps = Object.fromEntries(['g-open-dns', 'g-cname', 'g-verify-txt', 'g-dig', 'g-confirm'].map((id) => [id, { done: true }]));
    writeFileSync(join(proj, 'plans/docs/guides/dns-cutover/notes.json'), JSON.stringify({ version: 1, planVersion: '1', steps }));
    const html = readFileSync(guide, 'utf8');
    writeFileSync(guide, html.replace('data-id="g-redirects" data-who="claude" data-status="todo"', 'data-id="g-redirects" data-who="claude" data-status="done"'));
    await open(page, server.url);
    assert.equal(await page.locator('[data-id="ph-switch"] .pm-guide-prog').textContent(), 'Done');
    assert.equal(await page.locator('[data-id="ph-switch"]').evaluate((n) => n.classList.contains('pm-step-done')), true);
    assert.equal(await page.locator('#pm-prog').getAttribute('data-you'), '1/2');
    // The rail lists every phase under Steps, with where each one stands.
    const rail = await page.$$eval('nav.toc a.pm-rail-step', (as) => as.map((a) => `${a.dataset.pmState}:${a.textContent}`));
    assert.deepEqual(rail, ['current:Scaffold and import', 'todo:Review the migrated pages', 'done:Switch the domain over', 'todo:Retire the CMS']);
    await page.click('nav.toc a.pm-rail-step:has-text("Retire the CMS")');
    await page.waitForTimeout(700);
    const top = await page.locator('[data-id="ph-retire"]').evaluate((n) => n.getBoundingClientRect().top);
    assert.ok(top >= 0 && top < (await page.evaluate(() => innerHeight)) - 100, `phase at ${top}`);
    const d = show(plan);
    assert.equal(d.unit, 'phase');
    assert.deepEqual(d.lanes.you, { done: 1, total: 2 });
    assert.equal(d.guides[0].done, true);
    writeFileSync(guide, html);
  });

  test('the guide link opens the guide on its own review server', async () => {
    // The phase is done (its guide is), so it's folded: open it, then follow the link.
    await page.click('[data-id="ph-switch"] .pm-fold');
    await page.click('[data-id="ph-switch"] .pm-guide-link');
    await page.waitForSelector('html[data-pm-ready]');
    assert.equal(await page.getAttribute('html', 'data-pm-kind'), 'guide');
    assert.notEqual(new URL(page.url()).port, new URL(server.url).port);
  });
});

describe('a guide: its plan above the title, steps to follow', () => {
  let server, page;
  before(async () => {
    writeFileSync(join(proj, 'plans/docs/guides/dns-cutover/notes.json'), 'null');
    server = await serve(guide);
    page = await newPage(browser, errors, { width: 1280, height: 700 });
    await open(page, server.url);
  });

  test('says Guide, and links back to its plan and phase', async () => {
    assert.equal(await page.locator('#pm-top .pm-kind').textContent(), 'Guide');
    assert.equal(await page.locator('.pm-parent b').textContent(), 'Docs site migration');
    assert.equal(await page.locator('.pm-parent .pm-parent-phase').textContent(), 'Switch the domain over');
    const opts = await page.locator('#pm-status-sel option:not([disabled]):not([value="pm-remove"])').evaluateAll((o) => o.map((x) => x.value));
    assert.ok(opts.includes('not-started') && !opts.includes('approved'));
  });

  test('steps have no Make a guide; Mark done brings the next step into view', async () => {
    assert.equal(await page.locator('.pm-guide-btn').count(), 0);
    assert.equal(await page.locator('#pm-prog .pm-prog-txt').textContent(), '1 of 7 steps done');
    await page.locator('[data-id="g-verify-txt"]').scrollIntoViewIfNeeded();
    for (const id of ['g-open-dns', 'g-cname', 'g-verify-txt']) await page.click(`[data-id="${id}"] .pm-done-btn`);
    await page.waitForTimeout(700);
    const top = await page.locator('[data-id="g-dig"]').evaluate((n) => n.getBoundingClientRect().top);
    assert.ok(top > 0 && top < 700, `next step at ${top}`);
    assert.equal(await page.locator('.pm-current').getAttribute('data-id'), 'g-dig');
  });

  test('finished work folds: a done section on the page, done steps in the rail; one click opens either', async () => {
    // By now every step in "Add the records" is done.
    const sec = page.locator('section#records');
    assert.equal(await sec.evaluate((n) => n.classList.contains('pm-folded')), true);
    const fold = sec.locator('.pm-fold[data-fold="sec:records"]');
    assert.equal(await fold.textContent(), 'All 4 steps done');
    assert.equal(await page.locator('[data-id="g-cname"]').isVisible(), false);
    await fold.click();
    assert.equal(await page.locator('[data-id="g-cname"]').isVisible(), true);
    assert.equal(await fold.getAttribute('aria-expanded'), 'true');
    await fold.click();
    // The rail folds the same four into one row; it opens to show them.
    const row = page.locator('nav.toc .pm-rail-fold').first();
    assert.equal(await row.textContent(), 'All 4 done');
    assert.equal(await page.locator('nav.toc a.pm-rail-step:has-text("Point docs at the new site")').isVisible(), false);
    await row.click();
    const link = page.locator('nav.toc a.pm-rail-step:has-text("Point docs at the new site")');
    assert.equal(await link.isVisible(), true);
    // Following a link to a folded step opens its fold.
    await link.click();
    assert.equal(await page.locator('[data-id="g-cname"]').isVisible(), true);
    await row.click();
    // The rail scrolls on its own.
    assert.equal(await page.locator('nav.toc').evaluate((n) => getComputedStyle(n).overflowY), 'auto');
  });

  test('long steps other than the current one show their top part, faded, and open with one click', async () => {
    assert.equal(await page.locator('.step.pm-current > .pm-step-body.pm-clamped').count(), 0);
    assert.equal(await page.locator('.step.pm-current > .pm-more:visible').count(), 0);
    // The long steps are in the finished section, folded away: open it to see them.
    const fold = page.locator('.pm-fold[data-fold="sec:records"]');
    if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
    const step = page.locator('[data-id="g-cname"]');
    const more = step.locator(':scope > .pm-more');
    assert.equal(await step.locator(':scope > .pm-step-body.pm-clamped').count(), 1);
    assert.equal(await more.textContent(), 'Show all');
    const before = (await step.boundingBox()).height;
    await more.click();
    assert.equal(await more.textContent(), 'Show less');
    assert.ok((await step.boundingBox()).height > before);
    await more.click();
    assert.equal(await step.locator(':scope > .pm-step-body.pm-clamped').count(), 1);
  });

  test('the rail: each section with steps is a heading, its steps beneath with where each stands', async () => {
    const rail = await page.$$eval('nav.toc a', (as) => as.map((a) => (a.classList.contains('pm-rail-sec') ? '# ' : a.dataset.pmState ? `${a.dataset.pmState}:` : '') + a.textContent.trim()));
    assert.equal(rail[0], '# Add the records');
    assert.ok(rail.includes('done:Open the DNS settings for example.com'), rail.join(' | '));
    assert.ok(rail.includes('current:Check where docs points'), rail.join(' | '));
    assert.equal(await page.locator('nav.toc .toc-title').isVisible(), false);
  });

  test('Next step, under the progress bar, names the next step and jumps to it', async () => {
    await page.evaluate(() => scrollTo(0, 0));
    const next = page.locator('#pm-next');
    assert.equal(await next.locator('.pm-next-k').textContent(), 'Next step');
    assert.equal(await next.getAttribute('data-who'), 'you');
    assert.equal(await next.locator('.pm-next-t').textContent(), await page.locator('[data-id="g-dig"] h4').evaluate((h) => h.textContent.trim()));
    await next.click();
    await page.waitForTimeout(800);
    const top = await page.locator('[data-id="g-dig"]').evaluate((n) => n.getBoundingClientRect().top);
    assert.ok(top > 0 && top < 700, `next step at ${top}`);
    assert.equal(await page.evaluate(() => document.activeElement.closest('[data-id]')?.dataset.id), 'g-dig');
  });

  test('the registry: a guide that starts not started, lists its parent', () => {
    const d = show(guide);
    assert.equal(d.kind, 'guide');
    assert.equal(d.status, 'not-started');
    assert.equal(d.parentPath, plan);
    assert.equal(d.parentPhase, 'ph-switch');
    assert.ok(d.waiting.some((w) => w.key === 'steps' && /2 of your steps left: Check where docs points/.test(w.text)), JSON.stringify(d.waiting));
  });

  test('Part of opens the plan', async () => {
    await page.click('.pm-parent');
    await page.waitForSelector('html[data-pm-ready]');
    assert.equal(await page.getAttribute('html', 'data-pm-kind'), 'plan');
  });

  test('/api/open only follows links to plan-maker pages in the same project', async () => {
    const get = async (href) => (await fetch(`${server.url}api/open?href=${encodeURIComponent(href)}`, { redirect: 'manual' })).status;
    assert.equal(await get('../../../../../../../../etc/hosts'), 404);
    assert.equal(await get('../../../../docs/build.mjs'), 404);
    assert.equal(await get('../../index.html'), 302);
  });
});

describe('a reference: no progress, statuses of its own, stale when its sources change', () => {
  let server, page;
  before(async () => {
    cli('add', ref);
    server = await serve(ref);
    page = await newPage(browser, errors);
    await open(page, server.url);
  });

  test('says Reference, has no progress bar, and no Mark done', async () => {
    assert.equal(await page.locator('#pm-top .pm-kind').textContent(), 'Reference');
    assert.equal(await page.locator('#pm-prog').isHidden(), true);
    assert.equal(await page.locator('.pm-done-btn').count(), 0);
    assert.equal(await page.locator('[data-id="cmd-dev"] .pm-detail-btn').count(), 1);
    assert.equal(await page.locator('.pm-stale').count(), 0);
    const opts = await page.locator('#pm-status-sel option:not([disabled]):not([value="pm-remove"])').evaluateAll((o) => o.map((x) => x.value));
    assert.deepEqual(opts, ['draft', 'reviewing', 'current', 'archived']);
  });

  test('a reference can be current, never approved', async () => {
    const put = (status) => fetch(`${server.url}api/status`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) });
    assert.equal((await put('approved')).status, 400);
    assert.equal((await put('current')).status, 200);
    assert.equal(show(ref).status, 'current');
  });

  test('a source changed after the reference: the page and the hub say so', async () => {
    const later = new Date(Date.now() + 60e3);
    utimesSync(join(proj, 'docs/site.config.json'), later, later);
    await open(page, server.url);
    await page.waitForSelector('.pm-stale');
    assert.match(await page.locator('.pm-stale').textContent(), /docs\/site\.config\.json changed/);
    const d = show(ref);
    assert.deepEqual(d.stale, ['docs/site.config.json']);
    assert.ok(d.waiting.some((w) => w.key === 'stale'), JSON.stringify(d.waiting));
  });
});

test('an older page whose .phase blocks have no owner counts no phases', () => {
  const dir = join(proj, 'plans/old');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), `<!doctype html><meta name="plan-version" content="3"><title>Old</title><main data-plan>
    <div class="phase item" data-id="ph-0"><h3>Phase 0</h3></div><div class="phase-h" data-id="x"><h3>Header</h3></div></main>`);
  cli('add', join(dir, 'index.html'));
  const d = show(join(dir, 'index.html'));
  assert.deepEqual(d.lanes.you, { done: 0, total: 0 });
  assert.equal(d.waiting.filter((w) => w.key === 'steps').length, 0);
});

test('the hub nests a guide under its plan, marks each kind and filters by it', async () => {
  const port = 4400 + Math.floor(Math.random() * 60);
  const hub = spawn(process.execPath, [join(repo, 'scripts/hub.mjs'), '--no-open', '--port', String(port)], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    let out = '';
    const url = await new Promise((ok, bad) => {
      const t = setTimeout(() => bad(new Error('hub did not start:\n' + out)), 5000);
      hub.stdout.on('data', (d) => {
        out += d;
        const m = out.match(/open\s+→\s+(\S+)/);
        if (m) (clearTimeout(t), ok(m[1]));
      });
    });
    const pg = await newPage(browser, errors);
    await pg.goto(url);
    await pg.waitForSelector('#projects .row');
    // the guide is listed inside its plan's item
    assert.equal(await pg.locator('#projects li:has(> .row:has-text("Docs site migration")) > .kids .row').textContent().then((t) => /Switch the docs domain/.test(t)), true);
    assert.deepEqual(await pg.$$eval('#projects .row .kind', (els) => els.map((e) => e.dataset.k)).then((k) => [...new Set(k)].sort()), ['guide', 'plan', 'reference']);
    await pg.click('.kinds-filter button[data-kind="reference"]');
    assert.deepEqual(await pg.locator('#projects .row .name').allTextContents(), ['Docs build pipeline']);
    await pg.click('.kinds-filter button[data-kind="guide"]');
    assert.deepEqual(await pg.locator('#projects .row .name').allTextContents(), ['Switch the docs domain']);
    await pg.reload();
    await pg.waitForSelector('#projects .row');
    assert.equal(await pg.getAttribute('.kinds-filter button[data-kind="guide"]', 'aria-pressed'), 'true'); // remembered
    await pg.click('.kinds-filter button[data-kind=""]');
    assert.match(await pg.textContent('#sheet'), /Out of date: 1 source file changed/);
  } finally {
    hub.kill();
  }
});

test('bundling a plan bundles its guides, linked both ways', async () => {
  const out = join(proj, 'share/docs.html');
  const r = spawnSync(process.execPath, [join(repo, 'scripts/bundle.mjs'), plan, '-o', out], { cwd: proj, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const guideOut = join(proj, 'share/docs.guide-dns-cutover.html');
  assert.match(r.stdout, /docs\.guide-dns-cutover\.html/);
  const pg = await newPage(browser, errors);
  await pg.goto('file://' + out);
  await pg.waitForSelector('html[data-pm-ready]');
  assert.equal(await pg.getAttribute('[data-id="ph-switch"] .pm-guide-link', 'href'), 'docs.guide-dns-cutover.html');
  await pg.click('[data-id="ph-switch"] .pm-guide-link');
  await pg.waitForSelector('html[data-pm-ready]');
  assert.equal(pg.url(), 'file://' + guideOut);
  assert.equal(await pg.getAttribute('.pm-parent', 'href'), 'docs.html');
  assert.equal(await pg.locator('.pm-parent b').textContent(), 'Docs site migration');
  const solo = spawnSync(process.execPath, [join(repo, 'scripts/bundle.mjs'), plan, '-o', join(proj, 'share2/docs.html'), '--no-guides'], { cwd: proj, encoding: 'utf8' });
  assert.doesNotMatch(solo.stdout, /guide-/);
});

test('no console errors or uncaught exceptions', () => {
  assert.deepEqual(errors.filter((e) => !/http 404: .*favicon/.test(e)), []);
});

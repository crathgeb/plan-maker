// End-to-end tests: the review server + annotation layer in real Chrome.
//   npm test             (CHROME_PATH overrides the Chrome location)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { launch, newPage, open, planCopy, readNotes, repo, selectText, startServer, waitForNotes } from './helpers.mjs';

let browser;
const errors = [];
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

describe('template plan through the review server', () => {
  let server, files, page;
  before(async () => {
    files = planCopy(join(repo, 'templates/plan.html'));
    server = await startServer(files.plan);
    page = await newPage(browser, errors);
    await open(page, server.url);
  });
  after(() => server?.stop());

  test('selecting text and adding a note saves a highlight', async () => {
    // "One source. Pages are Markdown…": the selection crosses the <b> boundary
    const picked = await selectText(page, 'ap-source', 4, 35);
    await page.click('#pm-pop button[data-kind="note"]');
    await page.keyboard.type('Docs should live in the package folders');
    const notes = await waitForNotes(files.notes, (n) => n.highlights?.[0]?.note === 'Docs should live in the package folders');
    const h = notes.highlights[0];
    assert.equal(h.blockId, 'ap-source');
    assert.equal(h.quote, picked);
    assert.equal(h.quote, 'source. Pages are Markdown file');
    assert.match(h.where, /How it works › One source/);
  });

  test('blocks have one Comment button and no verdicts', async () => {
    assert.equal(await page.locator('.pm-v').count(), 0);
    assert.equal(await page.locator('[data-id="sum-goal"] .pm-note-btn').textContent(), 'Comment');
    assert.equal(await page.locator('.pm-ctl[data-for="ap-tree"] .pm-note-btn').count(), 1);
    await page.click('[data-id="risk-seo"] .pm-note-btn');
    await page.keyboard.type('Also check Bing');
    const notes = await waitForNotes(files.notes, (n) => n.items?.['risk-seo']?.note === 'Also check Bing');
    assert.equal(notes.items['risk-seo'].verdict, undefined);
    assert.equal(notes.items['risk-seo'].kind, 'note');
    assert.match(notes.items['risk-seo'].where, /What could go wrong › Search traffic dips/);
    assert.equal(await page.locator('[data-id="risk-seo"] .pm-note-btn').textContent(), 'Your comment');
  });

  test('item notes, section notes and general notes save', async () => {
    await page.click('[data-id="ph-2"] .pm-note-btn');
    await page.keyboard.type('Two weeks, not one');
    await page.click('#approach .pm-sec-note');
    await page.keyboard.type('Section-level note');
    await page.fill('#pm-general', 'Overall direction is right');
    const notes = await waitForNotes(files.notes, (n) => n.general === 'Overall direction is right');
    assert.equal(notes.items['ph-2'].note, 'Two weeks, not one');
    assert.equal(notes.items.approach.note, 'Section-level note');
    assert.equal(notes.items.approach.where, 'Section: How it works');
  });

  test('decisions save the choice, its label and the recommendation', async () => {
    await page.click('[data-id="d-generator"] input[value="docusaurus"]');
    await page.fill('[data-id="d-generator"] textarea.pm-dnote', 'We need versioning');
    const notes = await waitForNotes(files.notes, (n) => n.decisions?.generator?.note === 'We need versioning');
    assert.deepEqual(
      { choice: notes.decisions.generator.choice, label: notes.decisions.generator.label, recommended: notes.decisions.generator.recommended },
      { choice: 'docusaurus', label: 'Docusaurus', recommended: 'astro' },
    );
    assert.equal(notes.decisions.generator.question, 'Which generator?');
  });

  test('everything is restored after a reload', async () => {
    await page.waitForTimeout(500); // let the last debounced save land
    await page.reload();
    await page.waitForSelector('html[data-pm-ready]');
    const marked = await page.$$eval('mark.pm-hl', (ms) => ms.map((m) => m.textContent).join(''));
    assert.equal(marked, 'source. Pages are Markdown file');
    assert.equal(await page.locator('[data-id="ph-2"] .pm-note-btn.pm-has').count(), 1);
    assert.equal(await page.locator('[data-id="risk-seo"] .pm-note-btn.pm-has').count(), 1);
    assert.equal(await page.locator('[data-id="d-generator"] input[value="docusaurus"]').isChecked(), true);
    assert.equal(await page.inputValue('#pm-general'), 'Overall direction is right');
    assert.equal(await page.textContent('#pm-summary'), '4 comments · 1/2 decisions · 0/3 of your steps done');
    assert.equal(await page.locator('.pm-note').count(), 4);
  });

  test('the server refuses foreign hosts, non-JSON writes and paths outside the plan', async () => {
    const { port } = new URL(server.url);
    const call = (opts, body) =>
      new Promise((ok, bad) => {
        const req = request({ host: '127.0.0.1', port, ...opts }, (res) => {
          res.resume();
          ok(res.statusCode);
        });
        req.on('error', bad);
        req.end(body);
      });
    assert.equal(await call({ path: '/api/notes', headers: { host: 'evil.example' } }), 403);
    assert.equal(await call({ path: '/api/notes', method: 'PUT', headers: { 'content-type': 'text/plain' } }, '{}'), 415);
    assert.equal(await call({ path: '/../../etc/passwd' }), 404);
    assert.equal(await call({ path: '/%2e%2e/%2e%2e/etc/passwd' }), 404);
  });

  test('a second start for the same plan reuses the running server', () => {
    const { port } = new URL(server.url);
    const out = execFileSync(process.execPath, [join(repo, 'scripts/review.mjs'), files.plan, '--no-open', '--port', port], {
      encoding: 'utf8',
    });
    assert.match(out, /already reviewing/);
    assert.match(out, new RegExp(`:${port}/`));
  });

  test('phone width has no horizontal scroll, with the notes panel closed or open', async () => {
    const phone = await newPage(browser, errors, { width: 390, height: 844 });
    await open(phone, server.url);
    const overflow = () => phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.equal(await overflow(), 0);
    await phone.click('#pm-toggle');
    assert.equal(await phone.locator('#pm-panel').isVisible(), true);
    assert.equal(await overflow(), 0);
    await phone.close();
  });
});

describe('plain HTML with no data-ids', () => {
  let server, files, page;
  before(async () => {
    files = planCopy(join(repo, 'test/fixtures/plain.html'));
    server = await startServer(files.plan);
    page = await newPage(browser, errors);
    await open(page, server.url);
  });
  after(() => server?.stop());

  const ids = () => page.$$eval('[data-id]', (els) => els.map((e) => `${e.tagName.toLowerCase()}#${e.dataset.id}`));

  test('gets ids from its headings, and the same ids on every load', async () => {
    const first = await ids();
    assert.deepEqual(first, [
      'h1#plain-plan', 'p#plain-plan-1',
      'h2#goals', 'p#goals-1', 'li#goals-2', 'li#goals-3',
      'h2#risks', 'table#risks-1', 'tr#risks-2', 'tr#risks-3', 'pre#risks-4',
      'h2#goals--2', 'p#goals--2-1',
    ]);
    await page.reload();
    await page.waitForSelector('html[data-pm-ready]');
    assert.deepEqual(await ids(), first);
  });

  test('paragraphs, list items, rows and code get a Comment button; h2s get section comments', async () => {
    const items = await page.$$eval('.pm-item', (els) => els.map((e) => e.dataset.id));
    assert.deepEqual(items, ['plain-plan-1', 'goals-1', 'goals-2', 'goals-3', 'risks-2', 'risks-3', 'risks-4', 'goals--2-1']);
    assert.equal(await page.locator('.pm-sec-note').count(), 3);
  });

  test('notes and highlights work on auto ids', async () => {
    await page.click('[data-id="goals-3"] .pm-note-btn');
    await page.keyboard.type('Drop this');
    await selectText(page, 'risks-2', 0, 11);
    await page.click('#pm-pop button[data-kind="note"]');
    await page.keyboard.type('How large?');
    const notes = await waitForNotes(files.notes, (n) => n.highlights?.[0]?.note === 'How large?');
    assert.equal(notes.autoIds, true);
    assert.equal(notes.items['goals-3'].note, 'Drop this');
    assert.equal(notes.items['goals-3'].excerpt, 'Show a progress bar while importing.');
    assert.equal(notes.highlights[0].quote, 'Large files');
    await page.reload();
    await page.waitForSelector('html[data-pm-ready]');
    assert.equal(await page.$$eval('mark.pm-hl', (ms) => ms.map((m) => m.textContent).join('')), 'Large files');
  });

  test('phone width has no horizontal scroll', async () => {
    const phone = await newPage(browser, errors, { width: 390, height: 844 });
    await open(phone, server.url);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0);
    await phone.close();
  });
});

describe('standalone bundle', () => {
  test('opens from disk, saves in the browser and offers a download', async () => {
    const files = planCopy(join(repo, 'templates/plan.html'));
    const out = join(files.dir, 'shared.html');
    execFileSync(process.execPath, [join(repo, 'scripts/bundle.mjs'), files.plan, '-o', out], { cwd: files.dir });
    const html = readFileSync(out, 'utf8');
    assert.match(html, /window\.PLAN_MAKER = \{"mode":"standalone"/);
    const page = await newPage(browser, errors);
    await open(page, 'file://' + out);
    await page.click('#pm-toggle');
    await page.fill('#pm-general', 'Offline note');
    await page.click('[data-id="s2-scaffold"] .pm-note-btn');
    await page.keyboard.type('Offline comment');
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForSelector('html[data-pm-ready]');
    await page.click('#pm-toggle');
    assert.equal(await page.inputValue('#pm-general'), 'Offline note');
    assert.match(await page.textContent('#pm-status'), /browser/);
    await page.click('#pm-done');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#pm-export')]);
    assert.equal(download.suggestedFilename(), 'notes.json');
    const saved = JSON.parse(readFileSync(await download.path(), 'utf8'));
    assert.equal(saved.items['s2-scaffold'].note, 'Offline comment');
    assert.equal(readNotes(files.notes), null); // nothing written to disk without the server
    await page.close();
  });
});

test('no console errors or uncaught exceptions on any page', () => {
  assert.deepEqual(errors, []);
});

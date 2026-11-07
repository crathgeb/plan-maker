// Versions: snapshots, the switcher, read-only earlier versions, bundles.
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { launch, newPage, open, planCopy, readNotes, repo, selectText, startServer, waitForNotes, writeV2 } from './helpers.mjs';

let browser;
const errors = []; // must stay empty
const expected = []; // pages that deliberately trigger refused saves (409s log a console error)
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

const snapshot = (plan) =>
  spawnSync(process.execPath, [join(repo, 'scripts/snapshot.mjs'), plan], { cwd: join(plan, '..'), encoding: 'utf8' });

function httpGet(url, path) {
  const { port } = new URL(url);
  return new Promise((ok, bad) => {
    const req = request({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', bad);
    req.end();
  });
}

describe('versions of a plan', () => {
  let files, server, page;
  before(async () => {
    files = planCopy(join(repo, 'templates/plan.html'));
    server = await startServer(files.plan);
    page = await newPage(browser, expected); // this tab sees a refused save later
    await open(page, server.url);
  });
  after(() => server?.stop());

  test('a plan with no versions has no switcher', async () => {
    assert.equal(await page.locator('.pm-ver').isVisible(), false);
    const { body } = await httpGet(server.url, '/api/versions');
    const list = JSON.parse(body);
    assert.equal(list.current, 1);
    assert.deepEqual(list.versions.map((v) => v.version), [1]);
  });

  test('snapshot saves the plan and moves its notes into versions/', async () => {
    await selectText(page, 'ap-source', 4, 35);
    await page.click('#pm-pop');
    await page.keyboard.type('Per package?');
    await page.click('[data-id="risk-seo"] .pm-v[data-v="cut"]');
    await page.click('[data-id="d-cutover"] input[value="gradual"]');
    await page.fill('#pm-general', 'v1 general note');
    const saved = await waitForNotes(files.notes, (n) => n.general === 'v1 general note' && n.decisions?.cutover);
    assert.equal(saved.planVersion, '1');

    const r = snapshot(files.plan);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /saved v1 as \S*versions\/v1\.html/);
    assert.equal(readFileSync(join(files.dir, 'versions/v1.html'), 'utf8'), readFileSync(files.plan, 'utf8'));
    assert.deepEqual(JSON.parse(readFileSync(join(files.dir, 'versions/v1.notes.json'), 'utf8')), saved);
    assert.equal(existsSync(files.notes), false);

    const again = snapshot(files.plan);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /already saved/);
  });

  test('snapshot never overwrites a different saved version', () => {
    const before = readFileSync(join(files.dir, 'versions/v1.html'), 'utf8');
    writeFileSync(files.plan, readFileSync(files.plan, 'utf8').replace('</main>', '<p>edited without a version bump</p></main>'));
    const r = snapshot(files.plan);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /already exists and differs/);
    assert.equal(readFileSync(join(files.dir, 'versions/v1.html'), 'utf8'), before);
    writeFileSync(files.plan, before); // undo, then write v2 properly
    writeV2(files.plan);
  });

  test('a tab still on v1 cannot save its notes onto v2', async () => {
    await page.fill('#pm-general', 'typed after the revision');
    await page.waitForFunction(() => /Not saved/.test(document.getElementById('pm-status').textContent));
    assert.match(await page.textContent('#pm-status'), /now v2/);
    assert.equal(existsSync(files.notes), false);
  });

  test('the switcher lists every version, and v2 shows what changed', async () => {
    const p = await newPage(browser, errors);
    await open(p, server.url);
    assert.equal(await p.textContent('#pm-ver'), 'v2 ▾');
    await p.click('#pm-ver');
    const rows = await p.$$eval('#pm-vmenu a', (as) => as.map((a) => [a.querySelector('b').textContent, a.querySelector('.pm-vmeta').textContent, a.getAttribute('href')]));
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r[0]), ['v2', 'v1']);
    assert.match(rows[0][1], /^current · (9 Nov|Nov 9)$/); // date format follows the browser's locale
    assert.match(rows[1][1], /^read-only · (7 Nov|Nov 7) · 1 note · 1 cut · 1 decided$/);
    assert.equal(rows[1][2], '/versions/v1');
    assert.equal(await p.textContent('[data-id="ph-2"] .pm-changed'), 'changed in v2');
    assert.equal(await p.locator('#changes').isVisible(), true);
    await p.close();
  });

  test('v1 opens read-only with the notes written on it', async () => {
    const p = await newPage(browser, expected); // the PUT probe below logs a 409
    await open(p, server.url);
    await p.click('#pm-ver');
    await p.click('#pm-vmenu a[href="/versions/v1"]');
    await p.waitForURL('**/versions/v1');
    await p.waitForSelector('html[data-pm-ready]');
    assert.match(await p.textContent('#pm-banner'), /Viewing v1 \(read-only\)\.\s+The notes you wrote on v1 are shown\.\s+Back to current \(v2\)/);
    assert.equal(await p.textContent('#pm-ver'), 'v1 ▾');
    assert.equal(await p.$$eval('mark.pm-hl', (ms) => ms.map((m) => m.textContent).join('')), 'source. Pages are Markdown file');
    assert.equal(await p.locator('[data-id="risk-seo"].pm-cut').count(), 1);
    assert.equal(await p.locator('#changes').count(), 0); // v1 had no changes section
    assert.equal(await p.locator('.pm-changed').count(), 0);
    assert.equal(await p.locator('[data-id="d-cutover"] input[value="gradual"]').isChecked(), true);
    assert.equal(await p.inputValue('#pm-general'), 'v1 general note');
    assert.equal(await p.textContent('#pm-summary'), '1 note · 0 keep · 0 change · 1 cut · 1/2 decisions');
    // the panel lists the verdict-only item too
    assert.equal(await p.locator('.pm-note').count(), 2);

    // controls are disabled
    assert.equal(await p.locator('[data-id="risk-seo"] .pm-v[data-v="cut"]').isDisabled(), true);
    assert.equal(await p.locator('[data-id="d-cutover"] input[value="astro"], [data-id="d-cutover"] input[value="big-bang"]').isDisabled(), true);
    assert.equal(await p.locator('#pm-general').getAttribute('readonly'), '');
    assert.equal(await p.locator('#pm-done').isVisible(), false);
    assert.equal(await p.locator('[data-id="sum-goal"] .pm-ctl').isVisible(), false); // no verdict there: no controls
    await selectText(p, 'ap-redirects', 0, 10);
    await p.waitForTimeout(100);
    assert.equal(await p.locator('#pm-pop').isVisible(), false);
    const status = await p.evaluate(() =>
      fetch('/api/notes', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"general":"x"}' }).then((r) => r.status),
    );
    assert.equal(status, 409);
    assert.equal(existsSync(files.notes), false);

    // back to current
    await p.click('#pm-banner a');
    await p.waitForURL(server.url);
    await p.close();
  });

  test('the current version still saves', async () => {
    const p = await newPage(browser, errors);
    await open(p, server.url);
    await p.click('[data-id="sum-goal"] .pm-v[data-v="keep"]');
    const n = await waitForNotes(files.notes, (x) => x.items?.['sum-goal']?.verdict === 'keep');
    assert.equal(n.planVersion, '2');
    assert.equal(n.highlights.length, 0); // v1's notes stayed with v1
    await p.close();
  });

  test('relative links between versions resolve', async () => {
    assert.equal((await httpGet(server.url, '/versions/versions/v1')).status, 200); // "versions/v1" from /versions/v2
    const toLive = await httpGet(server.url, '/versions/index.html'); // "index.html" from a version page
    assert.equal(toLive.status, 302);
    assert.equal(toLive.headers.location, '/');
    assert.equal((await httpGet(server.url, '/versions/v1.notes.json')).status, 404); // notes only through the API
    assert.equal((await httpGet(server.url, '/versions/v7')).status, 404);
  });

  test('v1 read-only fits a phone', async () => {
    const p = await newPage(browser, errors, { width: 390, height: 844 });
    await open(p, server.url + 'versions/v1');
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0);
    await p.close();
  });

  test('bundle --all-versions links every version for offline reading', async () => {
    const out = join(files.dir, 'share/plan.html');
    mkdirSync(join(files.dir, 'share'));
    const r = spawnSync(process.execPath, [join(repo, 'scripts/bundle.mjs'), files.plan, '-o', out, '--all-versions'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(files.dir, 'share/plan.v1.html')));
    const p = await newPage(browser, errors);
    await open(p, 'file://' + out);
    await p.click('#pm-ver');
    await p.click('#pm-vmenu a[href="plan.v1.html"]');
    await p.waitForSelector('html[data-pm-ready]');
    assert.match(await p.textContent('#pm-banner'), /Viewing v1 \(read-only\)/);
    assert.equal(await p.$$eval('mark.pm-hl', (ms) => ms.map((m) => m.textContent).join('')), 'source. Pages are Markdown file');
    await p.click('#pm-banner a');
    await p.waitForURL('**/share/plan.html');
    await p.close();
  });
});

describe('an earlier version that carries its own review script', () => {
  let server, files;
  before(async () => {
    files = planCopy(join(repo, 'templates/plan.html'));
    writeV2(files.plan);
    mkdirSync(join(files.dir, 'versions'));
    copyFileSync(join(repo, 'test/fixtures/legacy-v1.html'), join(files.dir, 'versions/v1.html'));
    writeFileSync(join(files.dir, 'versions/v1.notes.json'), JSON.stringify({ general: 'notes from round one' }));
    server = await startServer(files.plan);
  });
  after(() => server?.stop());

  test('is shown as it was, with its own notes, a banner and no way to save', async () => {
    const p = await newPage(browser, expected); // its own script's save attempt is refused
    await open(p, server.url + 'versions/v1');
    await p.waitForFunction(() => document.getElementById('put').textContent !== '…');
    assert.equal(await p.textContent('#out'), 'notes from round one');
    assert.equal(await p.textContent('#put'), '409');
    assert.match(await p.textContent('#pm-banner'), /Viewing v1 \(read-only\)\.\s+This is the page as it was reviewed\./);
    assert.equal(await p.locator('#pm-panel').count(), 0); // plan-maker's own panel stays out of the way
    assert.equal(await p.textContent('#pm-ver'), 'v1 ▾');
    assert.deepEqual(JSON.parse(readFileSync(join(files.dir, 'versions/v1.notes.json'), 'utf8')), { general: 'notes from round one' });
    assert.equal(readNotes(files.notes), null);
    await p.close();
  });
});

test('no unexpected console errors', () => {
  assert.deepEqual(errors, []);
  // the expected ones are only the refused saves
  assert.ok(expected.every((e) => /409/.test(e)), expected.join('\n'));
});

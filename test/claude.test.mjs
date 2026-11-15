// Claude as a backend: Send to Claude makes a job, a listener hears it, job.mjs reports on it,
// and the page locks, follows and reloads. Also the floating toolbar: keys, the pen, drag and dock.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { launch, newPage, open, readNotes, repo, startServer, waitForNotes } from './helpers.mjs';

const temp = (name) => realpathSync(mkdtempSync(join(tmpdir(), name)));
process.env.PLAN_MAKER_HOME = temp('plan-maker-home-');
process.env.PLAN_MAKER_SCAN = 'off';
process.env.PLAN_MAKER_CLAUDE_GRACE_MS = '300';
process.env.PLAN_MAKER_LISTEN_RETRY_MS = '200';
process.env.PLAN_MAKER_LISTEN_SCAN_MS = '200';

const proj = temp('plan-maker-claude-');
mkdirSync(join(proj, '.git'));
function pageAt(slug) {
  const dir = join(proj, 'plans', slug);
  mkdirSync(dir, { recursive: true });
  const page = join(dir, 'index.html');
  copyFileSync(join(repo, 'templates/plan.html'), page);
  return { page, notes: join(dir, 'notes.json') };
}

function http(url, path, method = 'GET', body) {
  return new Promise((ok, bad) => {
    const u = new URL(path, url);
    const req = request({ host: u.hostname, port: u.port, path: u.pathname, method, headers: body !== undefined ? { 'content-type': 'application/json' } : {} }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => ok({ status: res.statusCode, body: data, json: () => JSON.parse(data) }));
    });
    req.on('error', bad);
    req.end(body !== undefined ? JSON.stringify(body) : undefined);
  });
}
const NOTES = { general: 'Tighten the timeline', items: {}, highlights: [], drawings: [], decisions: {}, steps: {} };
const node = (script, args) => execFileSync(process.execPath, [join(repo, 'scripts', script), ...args], { encoding: 'utf8' });

/** A process whose output we can wait on, line by line. */
function watchProc(args, opts = {}) {
  const proc = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  let out = '';
  proc.stdout.on('data', (d) => (out += d));
  proc.stderr.on('data', (d) => (out += d));
  const until = (re, timeout = 6000) =>
    new Promise((ok, bad) => {
      const t0 = Date.now();
      const tick = () => {
        const m = out.match(re);
        if (m) return ok(m);
        if (Date.now() - t0 > timeout) return bad(new Error(`never printed ${re}:\n${out}`));
        setTimeout(tick, 50);
      };
      tick();
    });
  return { proc, until, out: () => out, stop: () => proc.kill() };
}

const stops = [];
let browser;
const errors = [];
before(async () => {
  browser = await launch();
});
after(async () => {
  for (const s of stops) s();
  await browser?.close();
});

describe('the server and the scripts', () => {
  test('Send makes one job, the notes lock, a listener hears it, and job.mjs closes it', async () => {
    const { page } = pageAt('one');
    const srv = await startServer(page);
    stops.push(srv.stop);

    let r = await http(srv.url, '/api/send', 'POST', {});
    assert.equal(r.status, 400, 'nothing to send yet');
    assert.equal((await http(srv.url, '/api/notes', 'PUT', NOTES)).status, 204);

    // Sent while no one listens: it waits, and the notes are locked.
    r = await http(srv.url, '/api/send', 'POST', { message: 'and keep it short' });
    assert.equal(r.status, 200);
    const { job, created } = r.json();
    assert.equal(created, true);
    assert.equal(job.status, 'queued');
    assert.equal(job.version, 1);
    assert.equal(job.asks.general, true);
    assert.equal((await http(srv.url, '/api/notes', 'PUT', { ...NOTES, general: 'changed' })).status, 409);
    r = await http(srv.url, '/api/send', 'POST', {});
    assert.equal(r.json().created, false, 'a second Send is the same job');
    assert.equal(r.json().job.id, job.id);

    // A listener connects: it's offered the waiting job, with the commands to work it.
    const lis = watchProc([join(repo, 'scripts/listen.mjs'), page]);
    stops.push(lis.stop);
    await lis.until(/connected to "Docs site migration".*its notes are waiting/);
    const line = (await lis.until(/plan-maker: job (j_[a-z0-9]+): .*\n/))[0];
    assert.match(line, new RegExp(job.id));
    assert.match(line, /1 note|a note on the whole page/);
    assert.match(line, /The reader added: "and keep it short"/);
    assert.match(line, /job\.mjs .* start j_/);
    const pack = line.match(/"Read (\S+\.md) and do the job it describes\."/)[1];
    const text = readFileSync(pack, 'utf8');
    assert.match(text, /skills\/process-notes\/SKILL\.md/);
    assert.match(text, /snapshot\.mjs/);
    assert.match(text, /SUMMARY:/);
    assert.match(text, /> and keep it short/);
    assert.equal((await http(srv.url, '/api/jobs')).json().active.status, 'offered');
    assert.equal((await http(srv.url, '/api/health')).json().claude, true);

    // The page can't take the notes back once Claude has started.
    assert.match(node('job.mjs', [page, 'start', job.id]), /is running/);
    assert.equal((await http(srv.url, `/api/jobs/${job.id}/cancel`, 'POST', {})).status, 409);
    assert.match(node('job.mjs', [page, 'done', job.id, '--summary', 'SUMMARY: Tightened it']), /is done: Tightened it/);
    const after = (await http(srv.url, '/api/jobs')).json();
    assert.equal(after.active, null);
    assert.equal(after.jobs[0].summary, 'Tightened it');
    assert.equal(after.claude.phase, 'ready');
    assert.equal((await http(srv.url, '/api/notes', 'PUT', NOTES)).status, 204, 'unlocked');
    assert.match(node('job.mjs', [page, 'list']), new RegExp(`${job.id}\\s+done`));
    lis.stop();
  });

  test('an offer a session never started goes back to the queue when it leaves', async () => {
    const { page } = pageAt('two');
    const srv = await startServer(page);
    stops.push(srv.stop);
    await http(srv.url, '/api/notes', 'PUT', NOTES);
    const lis = watchProc([join(repo, 'scripts/listen.mjs'), page]);
    stops.push(lis.stop);
    await lis.until(/connected to/);
    const { job } = (await http(srv.url, '/api/send', 'POST', {})).json();
    await lis.until(/plan-maker: job j_/);
    assert.equal((await http(srv.url, '/api/jobs')).json().active.status, 'offered');
    lis.stop();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await http(srv.url, '/api/jobs')).json().active.status, 'queued');
    // The reader takes the notes back while they wait.
    assert.equal((await http(srv.url, `/api/jobs/${job.id}/cancel`, 'POST', {})).json().status, 'cancelled');
    assert.equal((await http(srv.url, '/api/jobs')).json().active, null);
  });

  test('a failed job unlocks the page and says why', async () => {
    const { page } = pageAt('three');
    const srv = await startServer(page);
    stops.push(srv.stop);
    await http(srv.url, '/api/notes', 'PUT', NOTES);
    const { job } = (await http(srv.url, '/api/send', 'POST', {})).json();
    node('job.mjs', [page, 'start', job.id]);
    assert.match(node('job.mjs', [page, 'fail', job.id, '--error', 'snapshot.mjs refused']), /is failed: snapshot\.mjs refused/);
    const j = (await http(srv.url, '/api/jobs')).json();
    assert.equal(j.active, null);
    assert.equal(j.claude.phase, 'error');
  });

  test('the project listener follows every page under the project, including servers started later', async () => {
    const a = pageAt('proj-a');
    const b = pageAt('proj-b');
    const srvA = await startServer(a.page);
    stops.push(srvA.stop);
    const lis = watchProc([join(repo, 'scripts/listen.mjs'), '--project', proj]);
    stops.push(lis.stop);
    await lis.until(/listening for notes on every page under/);
    await lis.until(new RegExp(`connected to "Docs site migration" at ${srvA.url.replace(/[/.]/g, '\\$&')}`));
    const srvB = await startServer(b.page);
    stops.push(srvB.stop);
    await lis.until(new RegExp(`connected to "Docs site migration" at ${srvB.url.replace(/[/.]/g, '\\$&')}`));
    await http(srvB.url, '/api/notes', 'PUT', NOTES);
    const { job } = (await http(srvB.url, '/api/send', 'POST', {})).json();
    const line = (await lis.until(new RegExp(`plan-maker: job ${job.id}.*`)))[0];
    assert.ok(line.includes(b.page), 'the job names its page');
    lis.stop();
  });

  test('job.mjs works on the files when no server runs', async () => {
    const { page, notes } = pageAt('offline');
    writeFileSync(notes, JSON.stringify(NOTES));
    const srv = await startServer(page);
    const { job } = (await http(srv.url, '/api/send', 'POST', {})).json();
    srv.stop();
    await new Promise((r) => setTimeout(r, 300));
    assert.match(node('job.mjs', [page, 'start', job.id]), /is running/);
    assert.match(node('job.mjs', [page, 'done', job.id, '--summary', 'Done offline']), /is done/);
  });
});

describe('a session takes its page over', () => {
  /** A stand-in for a server from before Send to Claude: health without `backend`, no events. */
  function fakeOldServer(page, port) {
    const code = `
      const { createServer } = require('node:http');
      const { createHash } = require('node:crypto');
      const planHash = createHash('sha256').update(${JSON.stringify(page)}).digest('hex').slice(0, 16);
      createServer((req, res) => {
        if (req.url === '/api/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ app: 'plan-maker', planHash, pid: process.pid })); }
        res.writeHead(404); res.end('not found');
      }).listen(${port}, '127.0.0.1', () => console.log('ready'));`;
    return watchProc(['-e', code]);
  }

  test('--replace stops the running server and takes its port, and an open tab reconnects', async () => {
    const { page: file } = pageAt('takeover');
    const first = await startServer(file);
    stops.push(first.stop);
    const page = await newPage(browser, errors);
    await open(page, first.url);
    const second = watchProc([join(repo, 'scripts/review.mjs'), file, '--no-open', '--replace']);
    stops.push(second.stop);
    await second.until(/replaced the server on port \d+ \(pid \d+, started elsewhere\)/);
    const url = (await second.until(/open\s+→\s+(\S+)/))[1];
    assert.equal(url, first.url, 'same port');
    assert.notEqual(await new Promise((ok) => (first.proc.exitCode != null ? ok(first.proc.exitCode) : first.proc.on('exit', ok))), undefined);
    // This session listens: the open tab finds the new server and says Claude is connected.
    const lis = watchProc([join(repo, 'scripts/listen.mjs'), file]);
    stops.push(lis.stop);
    await lis.until(/connected to/);
    await page.waitForSelector('#pm-claude[data-s="online"]', { timeout: 15000 });
    lis.stop();
    await page.close();
  });

  test('a server from an older build is replaced without --replace, and the listener says what to do', async () => {
    const { page: file } = pageAt('old-build');
    const port = 4600 + Math.floor(Math.random() * 90);
    const old = fakeOldServer(file, port);
    stops.push(old.stop);
    await old.until(/ready/);
    // A listener on it can't get events: it says so and stops.
    const lis = watchProc([join(repo, 'scripts/listen.mjs'), file], { env: { ...process.env, PLAN_MAKER_SCAN: `${port}-${port}` } });
    await lis.until(/older build without Send to Claude\. Restart it from this session: .*review\.mjs .* --replace/);
    assert.equal(await new Promise((ok) => (lis.proc.exitCode != null ? ok(lis.proc.exitCode) : lis.proc.on('exit', ok))), 1);
    const srv = watchProc([join(repo, 'scripts/review.mjs'), file, '--no-open', '--port', String(port)]);
    stops.push(srv.stop);
    await srv.until(/replaced the server on port \d+ \(pid \d+, an older build, without Send to Claude\)/);
    assert.equal((await srv.until(/open\s+→\s+(\S+)/))[1], `http://127.0.0.1:${port}/`);
    assert.equal((await http(`http://127.0.0.1:${port}/`, '/api/health')).json().backend, 1);
  });

  test('without --replace, a current server for the page is reused, as before', async () => {
    const { page: file } = pageAt('reuse');
    const first = await startServer(file);
    stops.push(first.stop);
    const out = node('review.mjs', [file, '--no-open']);
    assert.match(out, /already reviewing/);
    assert.equal(first.proc.exitCode, null);
  });
});

describe('the page', () => {
  test('Send locks the page, Claude writing shows, and done reloads into the new version', async () => {
    const { page: file, notes } = pageAt('ui');
    const srv = await startServer(file);
    stops.push(srv.stop);
    const page = await newPage(browser, errors);
    await open(page, srv.url);
    assert.equal(await page.locator('#pm-claude').getAttribute('data-s'), 'offline');
    assert.equal(await page.locator('#pm-send').isDisabled(), true, 'nothing to send yet');
    assert.equal(await page.locator('#pm-done').isVisible(), false);

    const lis = watchProc([join(repo, 'scripts/listen.mjs'), file]);
    stops.push(lis.stop);
    await lis.until(/connected to/);
    await page.waitForSelector('#pm-claude[data-s="online"]');

    await page.click('#pm-toggle');
    await page.fill('#pm-general', 'Cut phase 4');
    await page.waitForFunction(() => document.querySelector('#pm-send-n').textContent === '1');
    await page.click('#pm-send');
    const id = (await lis.until(/plan-maker: job (j_[a-z0-9]+)/))[1];
    await page.waitForSelector('html.pm-locked');
    assert.equal(readNotes(notes).general, 'Cut phase 4', 'Send saved what was typed first');
    assert.match(await page.textContent('#pm-lock'), /Claude has your notes/);
    assert.equal(await page.locator('#pm-send').isDisabled(), true);
    assert.equal(await page.locator('.pm-lock-undo').isVisible(), true);

    node('job.mjs', [file, 'start', id]);
    await page.waitForSelector('#pm-claude[data-s="working"]');
    assert.match(await page.textContent('#pm-lock'), /Claude is writing v2/);
    assert.equal(await page.locator('.pm-lock-undo').isVisible(), false);

    // The worker: snapshot, then v2 into the live file.
    node('snapshot.mjs', [file]);
    writeFileSync(file, readFileSync(file, 'utf8').replace('<meta name="plan-version" content="1">', '<meta name="plan-version" content="2">'));
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#pm-reload').isVisible(), false, 'no reload offer mid-round');
    const reloaded = page.waitForEvent('load');
    node('job.mjs', [file, 'done', id, '--summary', 'SUMMARY: Cut phase 4.']);
    await reloaded;
    await page.waitForSelector('html[data-pm-ready]');
    await page.waitForSelector('#pm-toast:not([hidden])');
    assert.match(await page.textContent('#pm-toast'), /v2 is ready: Cut phase 4\./);
    assert.equal(await page.locator('html.pm-locked').count(), 0);
    assert.equal(await page.locator('#pm-claude').getAttribute('data-s'), 'ready');
    assert.ok(existsSync(join(proj, 'plans/ui/versions/v1.notes.json')));
    lis.stop();
    await page.close();
  });

  test('Take them back unlocks, and the page offers a reload when the file changes outside a round', async () => {
    const { page: file } = pageAt('ui-cancel');
    const srv = await startServer(file);
    stops.push(srv.stop);
    const page = await newPage(browser, errors);
    await open(page, srv.url);
    await page.click('#pm-toggle');
    await page.fill('#pm-general', 'A note');
    await page.click('#pm-send');
    await page.waitForSelector('html.pm-locked');
    assert.match(await page.textContent('#pm-lock'), /waiting for Claude/);
    assert.equal(await page.locator('#pm-claude').getAttribute('data-s'), 'waiting');
    await page.click('.pm-lock-undo');
    await page.waitForFunction(() => !document.documentElement.classList.contains('pm-locked'));
    await page.fill('#pm-general', 'A note, edited');
    await page.waitForTimeout(600);
    assert.equal(JSON.parse(readFileSync(join(proj, 'plans/ui-cancel/notes.json'), 'utf8')).general, 'A note, edited');
    writeFileSync(file, readFileSync(file, 'utf8') + '\n');
    await page.waitForSelector('#pm-reload:not([hidden])');
    await page.close();
  });

  test('the toolbar: keys pick tools, the pen saves its stroke, and it drags and docks', async () => {
    const { page: file, notes } = pageAt('tools');
    const srv = await startServer(file);
    stops.push(srv.stop);
    const page = await newPage(browser, errors);
    await open(page, srv.url);
    assert.equal(await page.locator('#pm-tools button[data-shape=""]').getAttribute('aria-pressed'), 'true', 'Select is on');
    await page.keyboard.press('d');
    assert.equal(await page.locator('#pm-tools button[data-shape="pen"]').getAttribute('aria-pressed'), 'true');
    const box = await page.locator('[data-id="sum-goal"]').boundingBox();
    await page.mouse.move(box.x + 20, box.y + 10);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 20 + i * 15, box.y + 10 + (i % 2) * 12);
    await page.mouse.up();
    const saved = await waitForNotes(notes, (n) => n.drawings?.length === 1);
    const d = saved.drawings[0];
    assert.equal(d.shape, 'pen');
    assert.equal(d.blockId, 'sum-goal');
    assert.ok(d.points.length >= 6);
    assert.ok(d.points.every(([x, y]) => x >= 0 && x <= 1.2 && y >= -0.2 && y <= 1.5));
    assert.equal(await page.locator('#pm-shapes polyline').count(), 2, 'the stroke and its hit area');
    // Typing in a note doesn't pick tools.
    await page.keyboard.type('b');
    assert.equal(await page.locator('#pm-tools button[data-shape="box"]').getAttribute('aria-pressed'), 'false');
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('b');
    assert.equal(await page.locator('#pm-tools button[data-shape="box"]').getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('v');
    assert.equal(await page.locator('#pm-tools button[data-shape="box"]').getAttribute('aria-pressed'), 'false');

    // Drag it by its grip; it stays there after a reload; a double-click docks it.
    const grip = await page.locator('#pm-tools .pm-grip').boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(900, 300, { steps: 5 });
    await page.mouse.up();
    assert.equal(await page.locator('#pm-tools.pm-moved').count(), 1);
    await page.reload();
    await page.waitForSelector('html[data-pm-ready]');
    const moved = await page.locator('#pm-tools').boundingBox();
    assert.ok(Math.abs(moved.x - (900 - grip.width / 2 - (grip.x - 12))) < 40, `kept near where it was dropped (x ${moved.x})`);
    await page.dblclick('#pm-tools .pm-grip');
    assert.equal(await page.locator('#pm-tools.pm-moved').count(), 0);
    assert.equal(await page.locator('html.pm-tools-docked').count(), 1);

    // Focus: the top bar steps aside, and the toolbar carries Send and the way out.
    await page.keyboard.press('f');
    assert.equal(await page.locator('#pm-top').isVisible(), false);
    assert.equal(await page.locator('#pm-t-send').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#pm-top').isVisible(), true);
    await page.close();
  });

  test('earlier versions and bundled copies have no Send and no tools', async () => {
    const { page: file } = pageAt('ro');
    const srv = await startServer(file);
    stops.push(srv.stop);
    node('snapshot.mjs', [file]);
    writeFileSync(file, readFileSync(file, 'utf8').replace('<meta name="plan-version" content="1">', '<meta name="plan-version" content="2">'));
    const page = await newPage(browser, errors);
    await open(page, new URL('/versions/v1', srv.url).href);
    assert.equal(await page.locator('#pm-send').isVisible(), false);
    assert.equal(await page.locator('#pm-tools').isVisible(), false);
    await page.close();
  });
});

test('no console errors on any page', () => {
  assert.deepEqual(errors, []);
});

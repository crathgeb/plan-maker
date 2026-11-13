// Running review servers: records, health, idle stop, reuse on any port, and the hub's
// Running servers page (list, orphans, Stop).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { launch, newPage, repo, startServer } from './helpers.mjs';

// Records go to a temp home, and the hub scans no ports: it sees this file's servers only,
// never the ones running on this machine for real.
const temp = (name) => realpathSync(mkdtempSync(join(tmpdir(), name)));
const home = temp('plan-maker-home-');
process.env.PLAN_MAKER_HOME = home;
process.env.PLAN_MAKER_SCAN = 'off';
const proj = temp('plan-maker-srv-');
mkdirSync(join(proj, '.git'));
const pageAt = (slug, title) => {
  const p = join(proj, 'plans', slug, 'index.html');
  mkdirSync(join(proj, 'plans', slug), { recursive: true });
  copyFileSync(join(repo, 'templates/plan.html'), p);
  writeFileSync(p, readFileSync(p, 'utf8').replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`));
  return p;
};
const records = () => readdirSync(join(home, 'servers')).map((n) => JSON.parse(readFileSync(join(home, 'servers', n), 'utf8')));
const portOf = (url) => Number(new URL(url).port);
const exited = (proc) => new Promise((ok) => (proc.exitCode != null ? ok(proc.exitCode) : proc.on('exit', ok)));

function http(url, path, method = 'GET', body) {
  return new Promise((ok, bad) => {
    const u = new URL(path, url);
    const req = request({ host: u.hostname, port: u.port, path: u.pathname, method, headers: body ? { 'content-type': 'application/json' } : {} }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => ok({ status: res.statusCode, body: data, json: () => JSON.parse(data) }));
    });
    req.on('error', bad);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

const children = [];
function startHub() {
  const port = 4200 + Math.floor(Math.random() * 80);
  const proc = spawn(process.execPath, [join(repo, 'scripts/hub.mjs'), '--no-open', '--port', String(port)], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
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

let browser;
const servers = [];
const serve = async (page, extra) => {
  const s = await startServer(page, extra);
  servers.push(s);
  return s;
};
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
  for (const s of servers) s.stop();
  for (const c of children) c.kill();
  rmSync(proj, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test('a review server leaves a record while it runs and removes it when stopped', async () => {
  const page = pageAt('rec', 'Record plan');
  const s = await serve(page);
  const mine = records().find((r) => r.page === page);
  assert.ok(mine, 'a record for the page');
  assert.equal(mine.pid, s.proc.pid);
  assert.equal(mine.port, portOf(s.url));
  // Health, asked from this machine, says what the hub needs; idle counts seconds since a tab spoke.
  const h = (await http(s.url, '/api/health')).json();
  assert.equal(h.pid, s.proc.pid);
  assert.equal(h.page, page);
  assert.ok(h.idle >= 0);
  assert.equal((await http(s.url, '/api/ping', 'POST')).status, 204);
  s.stop();
  await exited(s.proc);
  assert.equal(records().some((r) => r.page === page), false, 'the record is gone');
});

test('a server no tab has spoken to stops itself; pings keep it running', async () => {
  const page = pageAt('idle', 'Idle plan');
  // 0.0006 h ≈ 2.2 s; it checks every quarter of that.
  const kept = await serve(page, ['--idle-hours', '0.0006']);
  const t0 = Date.now();
  while (Date.now() - t0 < 3500) {
    await http(kept.url, '/api/ping', 'POST');
    await new Promise((r) => setTimeout(r, 400));
  }
  assert.equal(kept.proc.exitCode, null, 'still running while a tab pings it');
  // Health checks (the hub's) don't count as a tab.
  const timer = setInterval(() => http(kept.url, '/api/health').catch(() => {}), 300);
  assert.equal(await exited(kept.proc), 0);
  clearInterval(timer);
  assert.match(kept.output(), /no tab has had .* open for 0\.0006 hours: stopping/);
  assert.equal(records().some((r) => r.page === page), false);
});

test('a second start finds the server for its page from its record, on any port', async () => {
  const page = pageAt('far', 'Far plan');
  const s = await serve(page, ['--port', '4650']);
  // No --port: it scans 4478 upward, which doesn't reach 4650; the record does.
  const again = spawn(process.execPath, [join(repo, 'scripts/review.mjs'), page, '--no-open'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  again.stdout.on('data', (d) => (out += d));
  assert.equal(await exited(again), 0);
  assert.match(out, /already reviewing/);
  assert.match(out, new RegExp(`127\\.0\\.0\\.1:${portOf(s.url)}/`));
});

test('the hub lists running servers, marks orphans, and stops them', async () => {
  const kept = pageAt('kept', 'Kept plan');
  const gone = pageAt('gone', 'Gone plan');
  const a = await serve(kept);
  const b = await serve(gone);
  rmSync(join(proj, 'plans', 'gone'), { recursive: true, force: true });
  const hub = await startHub();
  const list = (await http(hub, '/api/servers')).json().servers;
  const ka = list.find((x) => x.port === portOf(a.url));
  const gb = list.find((x) => x.port === portOf(b.url));
  assert.equal(ka.name, 'Kept plan');
  assert.equal(ka.shown, 'plans/kept/index.html');
  assert.equal(ka.project, proj.split('/').pop());
  assert.equal(ka.kind, 'plan');
  assert.equal(ka.orphan, false);
  assert.equal(ka.older, false);
  assert.equal(gb.orphan, true);
  assert.deepEqual(gb.why, ['missing']);

  // Stop refuses a server that isn't the one the hub listed.
  const wrong = (await http(hub, '/api/servers/stop', 'POST', { servers: [{ port: ka.port, planHash: '0000000000000000' }] })).json();
  assert.match(wrong.results[0].error, /already stopped/);
  assert.equal(a.proc.exitCode, null);
  assert.equal((await http(hub, '/api/servers/stop', 'POST', { servers: [{ port: 1 }] })).status, 200);
  assert.equal((await http(hub, '/api/servers/stop', 'POST')).status, 415);

  // The page: a count in the sidebar, the orphan flagged, Stop orphans stops only it.
  const errors = [];
  const p = await newPage(browser, errors);
  await p.goto(hub + '#servers');
  await p.waitForSelector('.srv');
  assert.equal(await p.textContent('#scount'), String(list.length));
  assert.ok(await p.$eval('#scount', (el) => el.classList.contains('warn')), 'orphans turn the count amber');
  assert.match(await p.textContent('.srv-list'), /Page deleted or moved/);
  assert.match(await p.textContent('.srv-list'), /Open in a tab/);
  await p.click('button[data-stop="orphans"]');
  await p.waitForSelector('.toast.show');
  assert.match(await p.textContent('.toast'), /Stopped 1 server/);
  assert.equal(await exited(b.proc), 0);
  assert.equal(a.proc.exitCode, null, 'the one still in use keeps running');
  assert.equal(await p.$('button[data-stop="orphans"]'), null);

  // One server's own Stop.
  await p.click(`button[data-stop-port="${portOf(a.url)}"]`);
  assert.equal(await exited(a.proc), 0);
  await p.waitForFunction((port) => !document.querySelector(`[data-stop-port="${port}"]`), portOf(a.url));
  assert.deepEqual(errors, []);
});

test('the duplicate of a page is the orphan; the lowest port is kept', async () => {
  const { classify } = await import('../lib/servers.mjs');
  const page = join(proj, '.git'); // any path that exists
  const out = classify([
    { port: 4480, page, idle: 10 },
    { port: 4479, page, idle: 9999 },
    { port: 4490, page: null, idle: null, older: true },
  ].sort((x, y) => x.port - y.port));
  assert.deepEqual(out.map((s) => [s.port, s.orphan, s.unused]), [[4479, false, true], [4480, true, false], [4490, false, false]]);
  assert.deepEqual(out[1].why, ['duplicate']);
});

test('the annotator pings its server every minute, and says when it has stopped', async () => {
  const page = pageAt('ping', 'Ping plan');
  const s = await serve(page);
  const p = await browser.newPage();
  await p.clock.install();
  await p.goto(s.url);
  await p.waitForSelector('html[data-pm-ready]');
  const pinged = p.waitForRequest((r) => r.url().endsWith('/api/ping') && r.method() === 'POST');
  await p.clock.runFor(61e3);
  await pinged;
  s.stop();
  await exited(s.proc);
  await p.clock.runFor(61e3);
  await p.waitForFunction(() => /review server stopped/.test(document.querySelector('#pm-status')?.textContent || ''));
});

test('Copy works inside the hub, and without clipboard permission', async () => {
  const page = pageAt('copy', 'Copy plan');
  const add = spawnSync(process.execPath, [join(repo, 'scripts/registry.mjs'), 'add', page, '--goal', 'Copy'], { env: process.env, encoding: 'utf8' });
  const id = add.stdout.match(/id ([0-9a-f]{10})/)[1];
  const hub = await startHub();
  const ctx = await browser.newContext();
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p = await ctx.newPage();
  const copyInFrame = async () => {
    await p.evaluate(() => navigator.clipboard.writeText('-'));
    const f = p.frames().find((x) => x !== p.mainFrame());
    await f.waitForSelector('html[data-pm-ready]');
    await f.click('.pm-copy', { force: true });
    await f.waitForFunction(() => document.querySelector('.pm-copy').textContent !== 'Copy');
    return [await f.textContent('.pm-copy'), await p.evaluate(() => navigator.clipboard.readText())];
  };
  await p.goto(`${hub}#${id}`);
  await p.waitForSelector('iframe.plan-frame[allow~="clipboard-write"]');
  assert.deepEqual(await copyInFrame(), ['Copied', 'docs/\n  guides/        how-to pages\n  reference/     generated from the API schema\n  redirects.json old URL → new URL']);
  // A frame the clipboard API refuses (like plain http from another device) falls back to the copy command.
  await p.evaluate(() => { const f = document.querySelector('iframe.plan-frame'); f.removeAttribute('allow'); f.src = f.src; });
  await p.waitForTimeout(500);
  assert.equal((await copyInFrame())[0], 'Copied');
  await ctx.close();
  for (const s of (await http(hub, '/api/servers')).json().servers.filter((x) => x.page === page)) await http(hub, '/api/servers/stop', 'POST', { servers: [{ port: s.port, planHash: s.planHash }] });
});

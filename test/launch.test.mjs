// launch.mjs: "launch my plans / docs" — register, take finished pages off the hub, serve the
// rest from one process, and stop them with it.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { repo } from './helpers.mjs';

const temp = (name) => realpathSync(mkdtempSync(join(tmpdir(), name)));
const home = temp('plan-maker-home-');
const proj = temp('plan-maker-launch-');
mkdirSync(join(proj, '.git'));
const env = { ...process.env, PLAN_MAKER_HOME: home, PLAN_MAKER_SCAN: 'off', PLAN_MAKER_HOST: '', PLAN_MAKER_TRUST: '' };

function write(rel, { kind, title, parent, units = '' }) {
  const p = join(proj, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `<!doctype html><html><head><meta charset="utf-8">
<meta name="pm-kind" content="${kind}"><meta name="plan-version" content="1">
${parent ? `<meta name="pm-parent" content="${parent}">` : ''}<title>${title}</title></head>
<body><main data-plan><header class="hero" data-id="hero"><h1>${title}</h1><p class="lede">${title}.</p></header>
<section class="sec" data-id="s"><h2>Work</h2>${units}</section></main></body></html>`);
  return p;
}
const todo = '<div class="step" data-id="a" data-who="claude" data-status="todo"><h3>A</h3></div>';
const allDone = '<div class="step" data-id="a" data-who="claude" data-status="done"><h3>A</h3></div>';

const plan = write('plans/live/index.html', { kind: 'plan', title: 'Live plan', units: '<div class="phase" data-id="p1" data-who="claude" data-status="todo"><h3>One</h3></div>' });
const guide = write('plans/live/guides/g/index.html', { kind: 'guide', title: 'Live guide', parent: '../../index.html', units: todo });
const doneGuide = write('plans/live/guides/finished/index.html', { kind: 'guide', title: 'Finished guide', parent: '../../index.html', units: allDone });
const shipped = write('plans/shipped/index.html', { kind: 'plan', title: 'Shipped plan', units: todo });
const orphan = write('plans/shipped/guides/left/index.html', { kind: 'guide', title: 'Leftover guide', parent: '../../index.html', units: todo });
const ref = write('docs/api/index.html', { kind: 'reference', title: 'API reference' });
const oldRef = write('docs/old/index.html', { kind: 'reference', title: 'Old reference' });
const howto = write('docs/howto/index.html', { kind: 'guide', title: 'Standalone guide', units: todo });

const reg = (...a) => spawnSync(process.execPath, [join(repo, 'scripts/registry.mjs'), ...a], { cwd: proj, env, encoding: 'utf8' });
const entries = () => JSON.parse(readFileSync(join(home, 'registry.json'), 'utf8'));
const paths = () => entries().entries.map((e) => e.path).sort();
const exited = (p) => new Promise((ok) => (p.exitCode != null ? ok(p.exitCode) : p.on('exit', ok)));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (check, ms = 6000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; ) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};
const health = (url) =>
  new Promise((ok) => {
    get(new URL('/api/health', url), (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => ok(JSON.parse(b)));
    }).on('error', () => ok(null));
  });

const procs = [];
function launch(...a) {
  const p = spawn(process.execPath, [join(repo, 'scripts/launch.mjs'), ...a], { cwd: proj, env, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(p);
  let out = '';
  p.stdout.on('data', (c) => (out += c));
  p.stderr.on('data', (c) => (out += c));
  return {
    proc: p,
    out: () => out,
    ready: () => until(() => /Stop this task/.test(out) || p.exitCode != null, 15000).then(() => out),
  };
}
const urls = (out) => Object.fromEntries([...out.matchAll(/^ {2}(.+?) \((plan|guide|reference)\)\s+(http:\S+)/gm)].map((m) => [m[1], m[3]]));

after(() => {
  for (const p of procs) try { p.kill('SIGKILL'); } catch {}
  rmSync(home, { recursive: true, force: true });
  rmSync(proj, { recursive: true, force: true });
});

test('setup: some pages registered, with statuses', () => {
  assert.equal(reg('add', plan, '--status', 'in-progress').status, 0);
  assert.equal(reg('add', shipped, '--status', 'done').status, 0);
  assert.equal(reg('add', oldRef, '--status', 'archived').status, 0);
  assert.equal(reg('add', ref, '--status', 'current').status, 0);
});

test('--dry-run says what it would do and changes nothing', () => {
  const before = readFileSync(join(home, 'registry.json'), 'utf8');
  const r = spawnSync(process.execPath, [join(repo, 'scripts/launch.mjs'), 'plans', '--dry-run'], { cwd: proj, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /would take "Shipped plan" .* off the hub: done/);
  assert.match(r.stdout, /would take "Leftover guide" .* off the hub: its plan is finished/);
  assert.match(r.stdout, /would take "Finished guide" .* off the hub: every step done/);
  assert.match(r.stdout, /would register "Live guide"/);
  assert.doesNotMatch(r.stdout, /would register "Finished guide"/); // finished: no goal to ask for
  assert.match(r.stdout, /would launch 2 plan pages/);
  assert.equal(readFileSync(join(home, 'registry.json'), 'utf8'), before);
});

test('launch plans: serves the live plan and its guide, takes finished ones off the hub for good', async () => {
  const l = launch('plans');
  const out = await l.ready();
  const u = urls(out);
  assert.deepEqual(Object.keys(u).sort(), ['Live guide', 'Live plan'], out);
  assert.match(out, /listen\.mjs --project /);
  assert.ok((await health(u['Live plan'])).backend);

  // Every page in the project is registered (whatever was launched); finished plan pages are off the hub.
  assert.deepEqual(paths(), [guide, howto, oldRef, plan, ref].sort());
  assert.deepEqual(entries().removed.map((r) => r.path).sort(), [doneGuide, orphan, shipped].sort());

  // A later scan leaves them off; add brings one back.
  assert.match(reg('scan', '.').stdout, /0 newly registered, 3 left off/);
  assert.ok(!paths().includes(shipped));
  assert.equal(reg('add', shipped).status, 0);
  assert.ok(paths().includes(shipped) && !entries().removed.some((r) => r.path === shipped));
  reg('remove', shipped);

  // Stopping the launcher stops its servers.
  const pids = await Promise.all(Object.values(u).map(async (x) => (await health(x)).pid));
  l.proc.kill('SIGTERM');
  await exited(l.proc);
  assert.ok(await until(() => pids.every((p) => !alive(p))), 'servers outlived the launcher');
});

test('launch docs: references and standalone guides; servers stop even if the launcher is killed outright', async () => {
  const l = launch('docs');
  const out = await l.ready();
  assert.deepEqual(Object.keys(urls(out)).sort(), ['API reference', 'Standalone guide'], out);
  assert.match(out, /took "Old reference" .* off the hub: archived/);
  assert.ok(entries().entries.some((e) => e.path === plan), 'plans are not touched by docs');

  const pids = await Promise.all(Object.values(urls(out)).map(async (x) => (await health(x)).pid));
  l.proc.kill('SIGKILL');
  assert.ok(await until(() => pids.every((p) => !alive(p)), 8000), 'servers outlived a killed launcher');
});

test('launching again takes over the servers the last run started, on the same ports', async () => {
  const a = launch('plans');
  const first = urls(await a.ready());
  const b = launch('plans');
  const second = urls(await b.ready());
  assert.deepEqual(second, first);
  assert.match(b.out(), /took over: started elsewhere/);
  assert.ok(await until(() => a.proc.exitCode != null), 'the first launcher exits once its servers are taken');
  b.proc.kill('SIGTERM');
  await exited(b.proc);
});

test('a page whose steps are all done stays while its status says the work goes on', () => {
  const busy = write('plans/busy/index.html', { kind: 'plan', title: 'Busy plan', units: allDone });
  assert.equal(reg('add', busy, '--status', 'in-progress').status, 0);
  const r = spawnSync(process.execPath, [join(repo, 'scripts/launch.mjs'), 'plans', '--dry-run'], { cwd: proj, env, encoding: 'utf8' });
  assert.match(r.stdout, /every step of "Busy plan" .* is done, but its status is in-progress, so it stays/);
  assert.match(r.stdout, /Busy plan \(plan, in-progress\)/);
  assert.doesNotMatch(r.stdout, /would take "Busy plan"/);
});

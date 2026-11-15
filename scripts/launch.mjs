#!/usr/bin/env node
// Launch a project's pages from one Claude Code session. Node built-ins only.
//
//   node launch.mjs [plans|docs|all] [--project DIR] [--host ADDR] [--dry-run]
//
//   plans  every plan, and the guides made from them        ("launch my plans")
//   docs   every reference, and the guides that stand alone  ("launch my docs")
//   all    both (the default)
//
// For the project (default: the git root of the current folder) it:
//   1. registers every plan-maker page that isn't on the hub yet (registry.mjs scan), except
//      pages taken off it earlier, and drops entries whose page is gone;
//   2. takes finished pages off the hub: status done or archived, a plan or guide whose every
//      phase and step is done (unless its status is in-progress or blocked: then it says so and
//      keeps it), or a guide whose plan is finished. They aren't launched, and a
//      later scan leaves them off (registry.mjs add brings one back);
//   3. starts a review server for each page left, with --replace (taking over any server
//      already serving it, on the same port, so open tabs reconnect), one at a time;
//   4. prints each page's URL and the listen.mjs command for them all, then keeps running.
//
// Run it as a background task of the session that will work the notes: the servers are its
// children and stop with it (each also stops if this process dies without a word). Running it
// again replaces the servers the last run started.

import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { allStepsDone, describe, find, findPages, finished, forgetMissing, load, projectOf, remove, save, upsert, wasRemoved } from '../lib/registry.mjs';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const REVIEW = join(SCRIPTS, 'review.mjs');
const SCOPES = ['plans', 'docs', 'all'];

function usage(msg) {
  if (msg) console.error(`launch: ${msg}`);
  console.error('usage: node launch.mjs [plans|docs|all] [--project DIR] [--host ADDR] [--dry-run]');
  process.exit(2);
}

let parsed;
try {
  parsed = parseArgs({ allowPositionals: true, options: { project: { type: 'string' }, host: { type: 'string' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
} catch (err) {
  usage(err.message);
}
const { values: o, positionals } = parsed;
if (o.help) usage();
if (positionals.length > 1) usage(`unexpected argument ${positionals[1]}`);
const scope = positionals[0] || 'all';
if (!SCOPES.includes(scope)) usage(`what to launch: ${SCOPES.join(', ')}`);

const project = projectOf(join(o.project || process.cwd(), 'x'));
const under = (p) => p === project || p.startsWith(project + sep);
const show = (p) => relative(project, p).split(sep).join('/') || p;

// ---------- 1. the registry, true for this project ----------
const reg = load();
const registered = [];
for (const page of findPages(project)) {
  if (find(reg, page) || wasRemoved(reg, page)) continue;
  const e = upsert(reg, page);
  registered.push(e);
}
const gone = reg.entries.filter((e) => under(e.path) && describe(e).missing);
for (const e of gone) remove(reg, e.id);
forgetMissing(reg);

// ---------- 2. finished pages come off the hub ----------
const described = reg.entries.filter((e) => under(e.path)).map(describe);
const byPath = new Map(described.map((d) => [d.path, d]));
const why = new Map();
for (const d of described) {
  const r = finished(d);
  if (r) why.set(d.path, r);
}
for (const d of described) {
  const parent = d.parentPath && byPath.get(d.parentPath);
  if (d.kind === 'guide' && !why.has(d.path) && parent && why.has(parent.path)) why.set(d.path, 'its plan is finished');
}
const inScope = (d) => {
  if (scope === 'all') return true;
  const hasPlan = d.kind === 'guide' && d.parentPath && byPath.get(d.parentPath)?.kind === 'plan';
  if (scope === 'plans') return d.kind === 'plan' || hasPlan;
  return d.kind === 'reference' || (d.kind === 'guide' && !hasPlan);
};
const cleaned = [];
for (const d of described) {
  if (!inScope(d) || !why.has(d.path)) continue;
  cleaned.push({ d, reason: why.get(d.path) });
  if (!o['dry-run']) remove(reg, d.id, d.status === 'archived' ? 'archived' : 'done');
}
const pages = described.filter((d) => inScope(d) && !why.has(d.path));
// Plans first, each followed by its guides, then the rest, by name.
const order = (d) => (d.kind === 'plan' ? `0 ${d.name}` : d.parentPath && byPath.has(d.parentPath) ? `0 ${byPath.get(d.parentPath).name} ${d.name}` : `${d.kind === 'guide' ? 1 : 2} ${d.name}`);
pages.sort((a, b) => order(a).localeCompare(order(b)));

if (!o['dry-run']) save(reg);

const report = (verb) => {
  for (const e of registered.filter((e) => !why.has(e.path))) console.log(`plan-maker: ${verb} "${e.name}" (${e.kind}, ${show(e.path)}): newly on the hub, give it a goal (registry.mjs update ${e.id} --goal "…")`);
  for (const e of gone) console.log(`plan-maker: dropped "${e.name}" from the hub: ${e.path} is gone`);
  for (const d of pages.filter(allStepsDone)) console.log(`plan-maker: every step of "${d.name}" (${d.kind}, ${show(d.path)}) is done, but its status is ${d.status}, so it stays. If it's finished: registry.mjs update ${d.id} --status done`);
  for (const { d, reason } of cleaned) console.log(`plan-maker: ${o['dry-run'] ? 'would take' : 'took'} "${d.name}" (${d.kind}, ${show(d.path)}) off the hub: ${reason}. Not launched.`);
};

if (o['dry-run']) {
  report('would register');
  console.log(`plan-maker: would launch ${pages.length} ${scope === 'all' ? 'page' : scope === 'plans' ? 'plan page' : 'doc'}${pages.length === 1 ? '' : 's'} under ${project}:`);
  for (const d of pages) console.log(`  ${d.name} (${d.kind}, ${d.status})  ${show(d.path)}`);
  process.exit(0);
}
report('registered');
if (!pages.length) {
  console.log(`plan-maker: nothing to launch under ${project} (${scope}): no active pages.`);
  process.exit(0);
}

// ---------- 3. a server per page, children of this process ----------
const children = new Map(); // child → page description
let stopping = false;

function start(d) {
  return new Promise((ok) => {
    const args = [REVIEW, d.path, '--replace', '--no-open', '--idle-hours', '0', ...(o.host ? ['--host', o.host] : [])];
    const child = spawn(process.execPath, args, { cwd: project, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PLAN_MAKER_PARENT_PID: String(process.pid) } });
    let out = '';
    let settled = false;
    const settle = (v) => {
      if (!settled) {
        settled = true;
        ok(v);
      }
    };
    const onData = (chunk) => {
      if (settled) {
        // Later news from a running server (it was replaced, it stopped): pass it on.
        for (const line of String(chunk).split('\n').filter(Boolean)) if (!/^\s|Ctrl-C/.test(line)) console.log(`  [${d.name}] ${line}`);
        return;
      }
      out += chunk;
      const url = out.match(/open\s+→\s+(http:\/\/\S+)/)?.[1];
      // Network mode prints its keyed URLs after "open →", and "Ctrl-C to stop." last.
      if (url && /Ctrl-C/.test(out)) settle({ child, url, replaced: /replaced the server on port \d+ \(pid \d+, ([^)]+)\)/.exec(out)?.[1] || null, net: [...out.matchAll(/(http:\/\/\S+\?key=\S+)/g)].map((m) => m[1]) });
    };
    child.stdout.setEncoding('utf8').on('data', onData);
    child.stderr.setEncoding('utf8').on('data', onData);
    child.on('exit', (code) => {
      if (!settled) return settle({ error: out.trim() || `exited with code ${code}` });
      children.delete(child);
      if (!stopping) console.log(`plan-maker: the server for "${d.name}" stopped${code ? ` (code ${code})` : ''}.${children.size ? '' : ' None left: launch again to restart them.'}`);
      if (!children.size) process.exit(0);
    });
    setTimeout(() => settle({ error: `didn't start within 10 s:\n${out.trim()}` }), 10000).unref();
    children.set(child, d);
  });
}

const started = [];
for (const d of pages) {
  const r = await start(d);
  if (r.error) {
    console.log(`plan-maker: couldn't start "${d.name}" (${show(d.path)}): ${r.error}`);
    continue;
  }
  started.push({ d, ...r });
}

// ---------- 4. say what's where ----------
const width = Math.min(48, Math.max(...started.map((s) => s.d.name.length + s.d.kind.length + 3), 0));
console.log(`\nplan-maker: serving ${started.length} page${started.length === 1 ? '' : 's'} under ${project} from this session:`);
for (const s of started) {
  const label = `${s.d.name} (${s.d.kind})`;
  console.log(`  ${label.padEnd(width)}  ${s.url}${s.replaced ? `   took over: ${s.replaced}` : ''}`);
  for (const n of s.net) console.log(`  ${' '.repeat(width)}  ${n}`);
}
const hub = await hubUrl();
if (hub) console.log(`  hub: ${hub}`);
console.log(`\nListen for their notes (Monitor, timeout 1800000): node ${join(SCRIPTS, 'listen.mjs')} --project ${project}`);
console.log('Stop this task to stop them all.');
if (!started.length) process.exit(1);

function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const child of children.keys()) try { child.kill('SIGTERM'); } catch {}
  setTimeout(() => process.exit(0), 3000).unref();
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, shutdown);
process.on('exit', () => {
  for (const child of children.keys()) try { child.kill('SIGTERM'); } catch {}
});

/** The hub's URL, if one is running. */
async function hubUrl() {
  const probe = (p) =>
    new Promise((ok) => {
      const req = get({ host: '127.0.0.1', port: p, path: '/api/health', timeout: 300 }, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          try {
            ok(JSON.parse(b).app === 'plan-maker-hub' ? `http://127.0.0.1:${p}/` : null);
          } catch {
            ok(null);
          }
        });
      });
      req.on('timeout', () => req.destroy());
      req.on('error', () => ok(null));
    });
  const hits = await Promise.all(Array.from({ length: 20 }, (_, i) => probe(4477 - i)));
  return hits.find(Boolean) || null;
}

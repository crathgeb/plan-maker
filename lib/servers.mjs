// Running review servers: finding them, telling which are orphans, stopping them.
// Node built-ins only.
//
// Each review server leaves a record at <home>/servers/<pid>.json while it runs
// ({ pid, port, page, started }), so it can be found on any port, including one
// the system picked. Its /api/health, asked from this machine, also says its pid,
// page, start time and how long since a tab last spoke to it.
//
// Servers from before records existed (plan-maker 0.2 and the first 0.3 builds)
// only answer { app, planHash }: they're found by scanning the usual ports, and
// their process and page are looked up with lsof and ps.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { join, resolve } from 'node:path';
import { home } from './registry.mjs';

/** The ports review servers try first (4478 upward), scanned for servers that left no record. */
export const SCAN_FROM = 4478;
export const SCAN_TO = 4529;
/** The ports to scan: PLAN_MAKER_SCAN="4478-4529" (the default) or "off" (records only, as the tests use). */
function scanPorts() {
  const v = process.env.PLAN_MAKER_SCAN || `${SCAN_FROM}-${SCAN_TO}`;
  const m = v.match(/^(\d+)-(\d+)$/);
  if (!m) return [];
  const out = [];
  for (let p = Number(m[1]); p <= Math.min(Number(m[2]), Number(m[1]) + 200); p++) out.push(p);
  return out;
}
/** No request from a tab for this long: no tab has the page open (open tabs ping every minute). */
export const UNUSED_SECONDS = 5 * 60;

/** How a review server names its page in /api/health: a hash, so the public answer never shows the path. */
export const pageHash = (page) => createHash('sha256').update(page).digest('hex').slice(0, 16);

const dir = () => join(home(), 'servers');
const recordPath = (pid) => join(dir(), `${pid}.json`);

export function writeRecord(rec) {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(recordPath(rec.pid), JSON.stringify(rec) + '\n');
}

export function removeRecord(pid = process.pid) {
  try { unlinkSync(recordPath(pid)); } catch {}
}

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** Every record whose process is still alive. Records left by a crashed server are deleted. */
export function readRecords() {
  let names;
  try {
    names = readdirSync(dir()).filter((n) => /^\d+\.json$/.test(n));
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    const pid = Number(n.slice(0, -5));
    let rec = null;
    try { rec = JSON.parse(readFileSync(join(dir(), n), 'utf8')); } catch {}
    if (!rec || rec.pid !== pid || !alive(pid)) {
      removeRecord(pid);
      continue;
    }
    out.push(rec);
  }
  return out;
}

/** GET /api/health on a loopback port: the parsed answer, or null. */
export function health(port, timeout = 400) {
  return new Promise((ok) => {
    const req = get({ host: '127.0.0.1', port, path: '/api/health', timeout }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { ok(JSON.parse(body)); } catch { ok(null); }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => ok(null));
  });
}

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function cwdOf(pid) {
  try { return readlinkSync(`/proc/${pid}/cwd`); } catch {}
  try { return sh('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).split('\n').find((l) => l.startsWith('n'))?.slice(1) || null; } catch {}
  return null;
}

/** The page argument of a review.mjs command line: the first argument that isn't an option. */
function pageArg(args) {
  const words = args.slice(args.indexOf('review.mjs') + 'review.mjs'.length).trim().split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (['--port', '--host', '--trust', '--idle-hours'].includes(w)) i++;
    else if (w && !w.startsWith('-')) return w;
  }
  return null;
}

// port:planHash → { pid, page }. A server's process doesn't change while it runs.
const older = new Map();
/** A server that left no record: its process (the one listening on the port, if it runs review.mjs) and page. */
function lookUp(port, planHash) {
  const key = `${port}:${planHash}`;
  if (older.has(key)) return older.get(key);
  let found = { pid: null, page: null };
  try {
    const pid = Number(sh('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).split('\n')[0]);
    const args = pid ? sh('ps', ['-o', 'args=', '-p', String(pid)]) : '';
    if (/review\.mjs/.test(args)) {
      found = { pid, page: null };
      const arg = pageArg(args);
      const cwd = arg && cwdOf(pid);
      if (cwd) {
        let page = resolve(cwd, arg);
        try { if (statSync(page).isDirectory()) page = join(page, 'index.html'); } catch {}
        if (pageHash(page) === planHash) found.page = page;
      }
    }
  } catch {}
  if (found.pid) older.set(key, found);
  return found;
}

/**
 * Every review server running on this machine, by port:
 * { port, pid, page, started, idle (seconds, null when it can't say), older (left no record), network }.
 */
export async function running() {
  const ports = new Set(readRecords().map((r) => r.port));
  for (const p of scanPorts()) ports.add(p);
  const out = [];
  await Promise.all([...ports].map(async (port) => {
    const h = await health(port);
    if (h?.app !== 'plan-maker' || !h.planHash) return;
    if (h.pid) {
      out.push({ port, pid: h.pid, page: h.page || null, started: h.started || null, idle: h.idle ?? null, network: !!h.network, older: false, planHash: h.planHash });
    } else {
      const { pid, page } = lookUp(port, h.planHash);
      out.push({ port, pid, page, started: null, idle: null, network: false, older: true, planHash: h.planHash });
    }
  }));
  return out.sort((a, b) => a.port - b.port);
}

/**
 * Why each server isn't needed, if it isn't: "missing" (its page was deleted or moved),
 * "duplicate" (another server already has its page; a new start reuses the lowest port),
 * "unused" (no tab has had it open for UNUSED_SECONDS). Orphans are missing or duplicate.
 */
export function classify(servers) {
  const first = new Map();
  for (const s of servers) if (s.page && !first.has(s.page)) first.set(s.page, s.port);
  return servers.map((s) => {
    const why = [];
    if (s.page && !existsSync(s.page)) why.push('missing');
    if (s.page && first.get(s.page) !== s.port) why.push('duplicate');
    const unused = s.idle != null && s.idle >= UNUSED_SECONDS;
    return { ...s, orphan: why.length > 0, unused, why };
  });
}

/**
 * Stop the review server on `port`, if it's still the one serving `planHash`.
 * Resolves once it no longer answers.
 */
export async function stop(port, planHash) {
  const h = await health(port);
  if (h?.app !== 'plan-maker' || (planHash && h.planHash !== planHash)) throw new Error('that server has already stopped');
  const pid = h.pid || lookUp(port, h.planHash).pid;
  if (!pid) throw new Error(`couldn't find its process: stop it with kill (it's listening on port ${port})`);
  process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 75));
    if ((await health(port, 200))?.planHash !== h.planHash) {
      removeRecord(pid);
      older.delete(`${port}:${h.planHash}`);
      return { port, pid };
    }
  }
  throw new Error('it is still running');
}

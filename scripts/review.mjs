#!/usr/bin/env node
// plan-maker review server. Node built-ins only.
//
//   node review.mjs <plan.html | plan-dir> [--port 4478] [--host 127.0.0.1] [--trust tailnet] [--no-open]
//
// Serves the plan with the annotation layer injected and saves the review to
// notes.json next to the plan as the reader works. Binds to 127.0.0.1 unless
// --host (or PLAN_MAKER_HOST) names another address, e.g. 0.0.0.0 for every
// interface or one address such as a VPN's. Beyond loopback, every request
// must carry this run's random key: the printed network URL has it as ?key=,
// which is swapped for a cookie on first visit. --trust (or PLAN_MAKER_TRUST)
// names networks whose devices need no key: "tailnet" (Tailscale's ranges)
// and/or IPv4 CIDRs, comma-separated. A trusted request must still address the
// server by an IP, a *.ts.net name or this machine's hostname, so a DNS
// rebinding page (which sends its own domain as Host) is still refused.
// If the port is taken it tries the next ones. If a plan-maker server is
// already reviewing the same plan, it reuses that one and exits.
//
// Earlier versions (versions/v<N>.html, see lib/versions.mjs) are served
// read-only at /versions/v<N>, with the notes written on them.
//
//   GET  /                 the live plan, annotation layer injected
//   GET  /versions/v<N>    version N, read-only, its notes shown
//   GET  /api/versions     every version, newest first
//   GET  /api/notes        the live plan's notes (a version's, when asked from its page)
//   PUT  /api/notes        save the live plan's notes
//   GET  /api/status       the plan's registry entry: { registered, name, status }
//   PUT  /api/status       change its status ({ status }); 404 if the plan isn't registered

import { spawn } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer, get } from 'node:http';
import { hostname, networkInterfaces, tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { inject, readLayer } from '../lib/inject.mjs';
import { currentVersion, isLegacy, listVersions, readJson, readVersion, snapshotNotesPath, snapshotPath } from '../lib/versions.mjs';
import { STATUSES, find, load as loadRegistry, save as saveRegistry, upsert } from '../lib/registry.mjs';

const LOOPBACK = '127.0.0.1';
const DEFAULT_PORT = 4478;
const PORT_TRIES = 20;
const MAX_BODY = 5 * 1024 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.pdf': 'application/pdf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

function usage(msg) {
  if (msg) console.error(`review: ${msg}`);
  console.error('usage: node review.mjs <plan.html | plan-dir> [--port N] [--host ADDR] [--trust tailnet,CIDR] [--no-open]');
  process.exit(2);
}

const argv = process.argv.slice(2);
let planArg = null;
let port = DEFAULT_PORT;
let open = true;
let host = process.env.PLAN_MAKER_HOST || LOOPBACK;
let trustArg = process.env.PLAN_MAKER_TRUST || '';
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--port') port = Number(argv[++i]);
  else if (a.startsWith('--port=')) port = Number(a.slice(7));
  else if (a === '--host') host = argv[++i];
  else if (a.startsWith('--host=')) host = a.slice(7);
  else if (a === '--trust') trustArg = argv[++i] || '';
  else if (a.startsWith('--trust=')) trustArg = a.slice(8);
  else if (a === '--no-open') open = false;
  else if (a === '-h' || a === '--help') usage();
  else if (a.startsWith('-')) usage(`unknown option ${a}`);
  else if (!planArg) planArg = a;
  else usage(`unexpected argument ${a}`);
}
if (!planArg) usage('which plan? pass the path to its HTML file');
if (!Number.isInteger(port) || port < 1 || port > 65535) usage('--port needs a number between 1 and 65535');
if (!host) usage('--host needs an address, e.g. 0.0.0.0 or 127.0.0.1');

// Network mode: listening beyond loopback. The Host-header check that guards
// the loopback server can't work there (LAN IPs, VPN names), so a per-run key
// takes its place. Requests from this machine to 127.0.0.1 still need no key.
const isLoopback = (a) => a === 'localhost' || a === '::1' || /^127\./.test(a);
const network = !isLoopback(host);
const wildcard = host === '0.0.0.0' || host === '::';
// Every mode answers on loopback too (a single --host address gets a second
// listener on 127.0.0.1), so this machine always uses http://127.0.0.1:<port>/.
const local = LOOPBACK;
const KEY = network ? randomBytes(18).toString('base64url') : null;
const trusted = parseTrust(trustArg);

let planPath = resolve(planArg);
if (existsSync(planPath) && statSync(planPath).isDirectory()) planPath = join(planPath, 'index.html');
if (!existsSync(planPath)) usage(`no such file: ${planArg}`);
const planDir = dirname(planPath);
const notesPath = join(planDir, 'notes.json');
// Where a network-mode run leaves its URLs, so a second start can print them
// (outside the plan folder, so it never ends up in a repo).
const planHash = createHash('sha256').update(planPath).digest('hex').slice(0, 16);
const runFile = join(tmpdir(), `plan-maker-${planHash}.json`);
const show = (p) => relative(process.cwd(), p) || '.';
const config = { mode: 'server', plan: show(planPath).split(sep).join('/'), notesPath: show(notesPath).split(sep).join('/') };

// ---------- an existing server for this plan? ----------
function probe(p) {
  return new Promise((ok) => {
    const req = get({ host: local, port: p, path: '/api/health', timeout: 400 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          ok(j.app === 'plan-maker' && (j.planHash === planHash || j.plan === planPath) ? p : null);
        } catch {
          ok(null);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => ok(null));
  });
}

const found = (await Promise.all(Array.from({ length: PORT_TRIES }, (_, i) => probe(port + i)))).find(Boolean);
if (found) {
  const run = readJson(runFile);
  const mine = run && run.port === found;
  const url = `http://${local}:${found}/`;
  console.log(`plan-maker: already reviewing ${config.plan}\n  open  → ${url}\n  notes → ${config.notesPath}`);
  if (mine) for (const line of run.lines) console.log(line);
  if (open) openBrowser(url);
  process.exit(0);
}

// ---------- server ----------
async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    // Health is public: the probe from a second start has no key. It names the plan only by a hash.
    if (url.pathname === '/api/health' && req.method === 'GET') {
      return send(res, 200, JSON.stringify({ app: 'plan-maker', planHash }), TYPES['.json']);
    }
    // Loopback: only requests addressed to this machine by name (blocks DNS rebinding).
    // Network mode: anything else must carry the key (rebinding pages never have it).
    const hostName = (req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    const fromHere = isLoopback(req.socket.remoteAddress?.replace(/^::ffff:/, '') || '') && ['127.0.0.1', 'localhost'].includes(hostName);
    if (!fromHere && !(network && isTrusted(req.socket.remoteAddress || '', hostName))) {
      if (!network) return send(res, 403, 'forbidden');
      const cookie = `pm_key_${boundPort}`;
      if (url.searchParams.has('key')) {
        if (!keyMatches(url.searchParams.get('key'))) return send(res, 403, 'wrong key: use the network URL this server printed');
        // Swap the key for a cookie and drop it from the address bar (and from Referer headers).
        url.searchParams.delete('key');
        res.setHeader('set-cookie', `${cookie}=${KEY}; Path=/; HttpOnly; SameSite=Strict`);
        return redirect(res, url.pathname + url.search);
      }
      if (!keyMatches(readCookie(req, cookie))) return send(res, 403, 'forbidden: open the network URL this server printed (it carries ?key=)');
    }
    // A relative link from one version page to another ("versions/v1" from
    // /versions/v2) resolves to /versions/versions/v1: treat it as /versions/v1.
    const path = decodeURIComponent(url.pathname).replace(/^(\/versions)+\//, '/versions/');
    // Which version's page made this request (an older page's own script calls /api/notes too).
    const from = versionOf(req.headers.referer);

    if (path === '/api/versions' && req.method === 'GET') {
      const versions = listVersions(planPath).map((v) => ({
        version: v.version,
        current: v.current,
        href: v.current ? '/' : `/versions/v${v.version}`,
        date: v.date,
        summary: v.summary,
      }));
      return send(res, 200, JSON.stringify({ current: versions[0].version, versions }), TYPES['.json']);
    }
    // The plan's status in the registry (~/.plan-maker), shown and changed from the top bar.
    if (path === '/api/status') {
      if (req.method === 'GET') {
        const e = find(loadRegistry(), planPath);
        return send(res, 200, JSON.stringify(e ? { registered: true, name: e.name, status: e.status } : { registered: false }), TYPES['.json']);
      }
      if (req.method === 'PUT') {
        if (!(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, 'expected JSON');
        if (from) return send(res, 409, `v${from} is read-only`);
        const { status } = JSON.parse(await readBody(req)) || {};
        if (!STATUSES.includes(status)) return send(res, 400, `status must be one of ${STATUSES.join(', ')}`);
        const reg = loadRegistry();
        if (!find(reg, planPath)) return send(res, 404, 'this plan is not registered');
        const e = upsert(reg, planPath, { status });
        saveRegistry(reg);
        return send(res, 200, JSON.stringify({ registered: true, name: e.name, status: e.status }), TYPES['.json']);
      }
      return send(res, 405, 'method not allowed');
    }
    if (path === '/api/notes') {
      if (req.method === 'GET') {
        if (from) {
          const f = snapshotNotesPath(planPath, from);
          return send(res, 200, f ? readFileSync(f, 'utf8') : 'null', TYPES['.json']);
        }
        return send(res, 200, existsSync(notesPath) ? readFileSync(notesPath, 'utf8') : 'null', TYPES['.json']);
      }
      if (req.method === 'PUT') {
        // A JSON content type forces a CORS preflight, which other sites fail.
        if (!(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, 'expected JSON');
        if (from) return send(res, 409, `v${from} is read-only`);
        const body = await readBody(req);
        const parsed = JSON.parse(body);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return send(res, 400, 'expected a JSON object');
        // Notes from a tab still showing an earlier version must not land on the new one.
        const live = readVersion(readFileSync(planPath, 'utf8'));
        const theirs = parsed.planVersion != null ? parseInt(parsed.planVersion, 10) : null;
        if (live && theirs && live !== theirs) return send(res, 409, `the plan is now v${live}; reload`);
        const tmp = notesPath + '.tmp';
        writeFileSync(tmp, JSON.stringify(parsed, null, 2) + '\n');
        renameSync(tmp, notesPath);
        return send(res, 204, '');
      }
      return send(res, 405, 'method not allowed');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');

    if (path === '/' || path === '/' + basename(planPath)) {
      // Read fresh every time so edits to the plan show on reload.
      const html = readFileSync(planPath, 'utf8');
      const html2 = inject(html, { ...config, version: currentVersion(planPath, html) }, readLayer());
      return send(res, 200, html2, TYPES['.html']);
    }
    const snap = path.match(/^\/versions\/v(\d+)(?:\.html)?$/);
    if (snap) {
      const n = parseInt(snap[1], 10);
      const file = snapshotPath(planPath, n);
      if (!existsSync(file)) return send(res, 404, `no v${n} of this plan`);
      const html = readFileSync(file, 'utf8');
      const notesFile = snapshotNotesPath(planPath, n);
      const legacy = isLegacy(html);
      const cfg = {
        ...config,
        mode: 'snapshot',
        readOnly: true,
        legacy,
        version: n,
        current: currentVersion(planPath),
        notes: !legacy && notesFile ? readJson(notesFile) : null,
      };
      return send(res, 200, inject(html, cfg, readLayer()), TYPES['.html']);
    }
    // Anything else: a file beside the plan (images, stylesheets…).
    // A version page's relative links ("img/chart.png") resolve under
    // /versions/; fall back to the plan's own folder for those.
    for (const p of path.startsWith('/versions/') ? [path, path.slice('/versions'.length)] : [path]) {
      const file = resolve(planDir, '.' + p);
      const inside = file.startsWith(planDir + sep);
      const hidden = relative(planDir, file).split(sep).some((seg) => seg.startsWith('.'));
      if (inside && !hidden && existsSync(file) && statSync(file).isFile()) {
        if (file === planPath) return redirect(res, '/'); // the live plan, from a version page's link
        if (file === notesPath || /\.notes\.json$|\/notes-v\d+\.json$/.test(file)) break; // notes go through /api
        return send(res, 200, readFileSync(file), TYPES[extname(file).toLowerCase()] || 'application/octet-stream');
      }
    }
    if (path === '/favicon.ico') return send(res, 204, ''); // no icon, and no console error about it
    send(res, 404, 'not found');
  } catch (err) {
    send(res, err instanceof SyntaxError ? 400 : 500, String(err.message || err));
  }
}
const server = createServer(handle);
const loopbackServer = network && !wildcard ? createServer(handle) : null;
let boundPort = null;

function redirect(res, location) {
  res.writeHead(302, { location, 'cache-control': 'no-store' });
  res.end();
}

function versionOf(referer) {
  if (!referer) return null;
  try {
    const m = new URL(referer).pathname.match(/^(?:\/versions)+\/v(\d+)(?:\.html)?$/);
    return m ? parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
}

function bind(srv, p, addr) {
  return new Promise((ok, bad) => {
    srv.once('error', bad);
    srv.listen(p, addr, () => {
      srv.off('error', bad);
      ok();
    });
  });
}

async function listen(p, triesLeft) {
  try {
    await bind(server, p, host);
    if (loopbackServer) {
      try {
        await bind(loopbackServer, p, LOOPBACK);
      } catch (err) {
        await new Promise((r) => server.close(r));
        throw err;
      }
    }
  } catch (err) {
    if (err.code === 'EADDRINUSE' && triesLeft > 1) return listen(p + 1, triesLeft - 1);
    console.error(`review: could not start the server: ${err.message}`);
    process.exit(1);
  }
  boundPort = p;
  const url = `http://${local}:${p}/`;
  if (p !== port) console.log(`plan-maker: port ${port} is busy, using ${p}`);
  console.log(`plan-maker: reviewing ${config.plan}${network ? ' (network mode)' : ''}\n  open  → ${url}\n  notes → ${config.notesPath}`);
  if (network) {
    // Each address another device could use: every interface's, or the one --host named.
    const addrs = wildcard ? networkUrls() : [[host, '']];
    const lines = addrs.map(([addr, name], i) => `  ${i ? '       ' : 'net  →'} http://${addr.includes(':') ? `[${addr}]` : addr}:${p}/?key=${KEY}${name ? `   (${name})` : ''}`);
    if (!lines.length) lines.push('  net  → no network address found on this machine');
    if (trusted.length) lines.push(`  trust → no key needed from ${trusted.map((t) => t.label).join(', ')}`);
    lines.push('  The key changes every run. Anyone else without it gets 403.');
    for (const line of lines) console.log(line);
    try { writeFileSync(runFile, JSON.stringify({ port: p, lines }), { mode: 0o600 }); } catch {}
  }
  console.log('Ctrl-C to stop.');
  if (open) openBrowser(url);
}
listen(port, PORT_TRIES);

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  if (network) try { unlinkSync(runFile); } catch {}
  loopbackServer?.close();
  server.close(() => process.exit(0));
});

// ---------- helpers ----------
/** "tailnet,192.168.1.0/24" → [{label, test(addr)}]. Exits on anything it can't read. */
function parseTrust(arg) {
  const out = [];
  for (const raw of String(arg).split(',').map((x) => x.trim()).filter(Boolean)) {
    if (raw === 'tailnet' || raw === 'tailscale') {
      out.push({ label: 'tailnet', test: (a) => inCidr(a, '100.64.0.0', 10) || /^fd7a:115c:a1e0:/i.test(a) });
      continue;
    }
    const m = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
    if (!m || Number(m[2]) > 32 || ipv4(m[1]) === null) usage(`--trust: expected "tailnet" or an IPv4 CIDR like 192.168.1.0/24, got "${raw}"`);
    out.push({ label: raw, test: (a) => inCidr(a, m[1], Number(m[2])) });
  }
  return out;
}

function ipv4(a) {
  const parts = a.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

function inCidr(addr, base, bits) {
  const a = ipv4(addr.replace(/^::ffff:/, '')), b = ipv4(base);
  if (a === null || b === null) return false;
  const size = 2 ** (32 - bits);
  return Math.floor(a / size) === Math.floor(b / size);
}

/** From a trusted network, and addressed by a name a rebinding page can't send. */
function isTrusted(remote, hostName) {
  if (!trusted.some((t) => t.test(remote.replace(/^::ffff:/, '')))) return false;
  const h = hostName.toLowerCase();
  const me = hostname().toLowerCase().replace(/\.local$/, '');
  // Never match on a label prefix: a rebinding page could use <hostname>.evil.example.
  return ipv4(h) !== null || h.includes(':') || h.endsWith('.ts.net') || h === me || h === `${me}.local`;
}

function keyMatches(given) {
  if (!KEY || typeof given !== 'string') return false;
  const a = Buffer.from(given), b = Buffer.from(KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** [IPv4 address, interface] pairs a browser on another device could use to reach this server. */
function networkUrls() {
  const out = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.internal || a.family !== 'IPv4') continue;
      out.push([a.address, name]);
    }
  }
  return out;
}
function readBody(req) {
  return new Promise((ok, bad) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        bad(new Error('notes too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', bad);
  });
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => console.log(`Open ${url} in your browser.`));
    child.unref();
  } catch {
    console.log(`Open ${url} in your browser.`);
  }
}

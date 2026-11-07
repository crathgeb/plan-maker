#!/usr/bin/env node
// plan-maker review server. Node built-ins only.
//
//   node review.mjs <plan.html | plan-dir> [--port 4478] [--no-open]
//
// Serves the plan with the annotation layer injected and saves the review to
// notes.json next to the plan as the reader works. Binds to 127.0.0.1 only.
// If the port is taken it tries the next ones. If a plan-maker server is
// already reviewing the same plan, it reuses that one and exits.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createServer, get } from 'node:http';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { inject, readLayer } from '../lib/inject.mjs';

const HOST = '127.0.0.1';
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
  console.error('usage: node review.mjs <plan.html | plan-dir> [--port N] [--no-open]');
  process.exit(2);
}

const argv = process.argv.slice(2);
let planArg = null;
let port = DEFAULT_PORT;
let open = true;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--port') port = Number(argv[++i]);
  else if (a.startsWith('--port=')) port = Number(a.slice(7));
  else if (a === '--no-open') open = false;
  else if (a === '-h' || a === '--help') usage();
  else if (a.startsWith('-')) usage(`unknown option ${a}`);
  else if (!planArg) planArg = a;
  else usage(`unexpected argument ${a}`);
}
if (!planArg) usage('which plan? pass the path to its HTML file');
if (!Number.isInteger(port) || port < 1 || port > 65535) usage('--port needs a number between 1 and 65535');

let planPath = resolve(planArg);
if (existsSync(planPath) && statSync(planPath).isDirectory()) planPath = join(planPath, 'index.html');
if (!existsSync(planPath)) usage(`no such file: ${planArg}`);
const planDir = dirname(planPath);
const notesPath = join(planDir, 'notes.json');
const show = (p) => relative(process.cwd(), p) || '.';
const config = { mode: 'server', plan: show(planPath).split(sep).join('/'), notesPath: show(notesPath).split(sep).join('/') };

// ---------- an existing server for this plan? ----------
function probe(p) {
  return new Promise((ok) => {
    const req = get({ host: HOST, port: p, path: '/api/health', timeout: 400 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          ok(j.app === 'plan-maker' && j.plan === planPath ? p : null);
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
  const url = `http://${HOST}:${found}/`;
  console.log(`plan-maker: already reviewing ${config.plan}\n  open  → ${url}\n  notes → ${config.notesPath}`);
  if (open) openBrowser(url);
  process.exit(0);
}

// ---------- server ----------
const server = createServer(async (req, res) => {
  try {
    // Only answer requests addressed to this machine (blocks DNS rebinding).
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost'].includes(host)) return send(res, 403, 'forbidden');
    const url = new URL(req.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname);

    if (path === '/api/health' && req.method === 'GET') {
      return send(res, 200, JSON.stringify({ app: 'plan-maker', plan: planPath, notes: notesPath }), TYPES['.json']);
    }
    if (path === '/api/notes') {
      if (req.method === 'GET') {
        return send(res, 200, existsSync(notesPath) ? readFileSync(notesPath, 'utf8') : 'null', TYPES['.json']);
      }
      if (req.method === 'PUT') {
        // A JSON content type forces a CORS preflight, which other sites fail.
        if (!(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, 'expected JSON');
        const body = await readBody(req);
        const parsed = JSON.parse(body);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return send(res, 400, 'expected a JSON object');
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
      const html = inject(readFileSync(planPath, 'utf8'), config, readLayer());
      return send(res, 200, html, TYPES['.html']);
    }
    // Anything else: a file beside the plan (images, stylesheets…).
    const file = resolve(planDir, '.' + path);
    const inside = file.startsWith(planDir + sep);
    const hidden = relative(planDir, file).split(sep).some((s) => s.startsWith('.'));
    if (inside && !hidden && existsSync(file) && statSync(file).isFile()) {
      return send(res, 200, readFileSync(file), TYPES[extname(file).toLowerCase()] || 'application/octet-stream');
    }
    if (path === '/favicon.ico') return send(res, 204, ''); // no icon, and no console error about it
    send(res, 404, 'not found');
  } catch (err) {
    send(res, err instanceof SyntaxError ? 400 : 500, String(err.message || err));
  }
});

function listen(p, triesLeft) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && triesLeft > 1) return listen(p + 1, triesLeft - 1);
    console.error(`review: could not start the server: ${err.message}`);
    process.exit(1);
  });
  server.listen(p, HOST, () => {
    const url = `http://${HOST}:${p}/`;
    if (p !== port) console.log(`plan-maker: port ${port} is busy, using ${p}`);
    console.log(`plan-maker: reviewing ${config.plan}\n  open  → ${url}\n  notes → ${config.notesPath}\nCtrl-C to stop.`);
    if (open) openBrowser(url);
  });
}
listen(port, PORT_TRIES);

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));

// ---------- helpers ----------
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

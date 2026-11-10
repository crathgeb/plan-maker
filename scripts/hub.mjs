#!/usr/bin/env node
// The hub: one page listing every registered plan, guide and reference, with
// their goal, status and live progress. Node built-ins only. Loopback only.
//
//   node hub.mjs [--port 4477] [--no-open]
//
// Opening a plan from the hub starts (or reuses) that plan's review server and
// redirects to it, so every link works even when nothing else is running.
//
//   GET   /                  the hub page
//   GET   /api/entries       every entry, with live progress
//   PATCH /api/entries/<id>  change status, next, goal, name, description; {log} appends a progress line
//   GET   /open/<id>         start or reuse the review server for that page, then redirect to it

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, get } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startReview } from '../lib/launch.mjs';
import { describe, find, load, registryPath, save, upsert } from '../lib/registry.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = join(here, '..', 'lib', 'hub.html');
// The hub wears the plan page's own styles: the template's <style> block is injected
// at <!-- plan-styles -->, read fresh on every request so the two never drift apart.
const TEMPLATE = join(here, '..', 'templates', 'plan.html');
function hubPage() {
  const html = readFileSync(PAGE, 'utf8');
  let style = '';
  try {
    // The template's own style element: on a line of its own, after its head comment.
    style = readFileSync(TEMPLATE, 'utf8').match(/^<style>$[\s\S]*?^<\/style>$/m)?.[0] || '';
  } catch {}
  return html.replace('<!-- plan-styles -->', () => style);
}
const HOST = '127.0.0.1';
const DEFAULT_PORT = 4477;
const PORT_TRIES = 20; // 4477 downward, clear of the review servers' 4478 upward

let port = DEFAULT_PORT;
let open = true;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--port') port = Number(argv[++i]);
  else if (a.startsWith('--port=')) port = Number(a.slice(7));
  else if (a === '--no-open') open = false;
  else {
    console.error('usage: node hub.mjs [--port N] [--no-open]');
    process.exit(2);
  }
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('hub: --port needs a number between 1 and 65535');
  process.exit(2);
}

// ---------- a hub already running? ----------
function probe(p) {
  return new Promise((ok) => {
    const req = get({ host: HOST, port: p, path: '/api/health', timeout: 400 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          ok(j.app === 'plan-maker-hub' && j.registry === registryPath() ? p : null);
        } catch {
          ok(null);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => ok(null));
  });
}
const ports = Array.from({ length: PORT_TRIES }, (_, i) => port - i).filter((p) => p > 0);
const found = (await Promise.all(ports.map(probe))).find(Boolean);
if (found) {
  const url = `http://${HOST}:${found}/`;
  console.log(`plan-maker hub: already running\n  open  → ${url}`);
  if (open) openBrowser(url);
  process.exit(0);
}

// ---------- server ----------
async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/health') return json(res, 200, { app: 'plan-maker-hub', registry: registryPath() });
    // Only requests addressed to this machine by name (blocks DNS rebinding).
    const hostName = (req.headers.host || '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost'].includes(hostName)) return send(res, 403, 'forbidden');

    if (url.pathname === '/' && req.method === 'GET') return send(res, 200, hubPage(), 'text/html; charset=utf-8');
    if (url.pathname === '/api/entries' && req.method === 'GET') {
      return json(res, 200, { registry: registryPath(), entries: load().entries.map(describe) });
    }
    const m = url.pathname.match(/^\/api\/entries\/([0-9a-f]{10})$/);
    if (m && req.method === 'PATCH') {
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, 'expected JSON');
      const body = JSON.parse(await readBody(req));
      const reg = load();
      if (!find(reg, m[1])) return send(res, 404, 'not registered');
      const { log, ...rest } = body || {};
      const fields = Object.fromEntries(Object.entries(rest).filter(([k]) => ['status', 'next', 'goal', 'name', 'description'].includes(k)));
      try {
        const e = upsert(reg, m[1], fields, log || null);
        save(reg);
        return json(res, 200, describe(e));
      } catch (err) {
        return send(res, 400, err.message);
      }
    }
    const o = url.pathname.match(/^\/open\/([0-9a-f]{10})$/);
    if (o && req.method === 'GET') {
      const e = find(load(), o[1]);
      if (!e) return send(res, 404, 'not registered');
      const { url: target } = await startReview(e.path);
      res.writeHead(302, { location: target, 'cache-control': 'no-store' });
      return res.end();
    }
    if (url.pathname === '/favicon.ico') return send(res, 204, '');
    send(res, 404, 'not found');
  } catch (err) {
    send(res, err instanceof SyntaxError ? 400 : 500, String(err.message || err));
  }
}

const server = createServer(handle);
function listen(i) {
  if (i >= ports.length) {
    console.error('hub: no free port');
    process.exit(1);
  }
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') return listen(i + 1);
    console.error(`hub: could not start: ${err.message}`);
    process.exit(1);
  });
  server.listen(ports[i], HOST, () => {
    const url = `http://${HOST}:${ports[i]}/`;
    console.log(`plan-maker hub: ${load().entries.length} registered\n  open  → ${url}\n  registry → ${registryPath()}\nCtrl-C to stop.`);
    if (open) openBrowser(url);
  });
}
listen(0);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));

// ---------- helpers ----------
function readBody(req) {
  return new Promise((ok, bad) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1e6) {
        bad(new Error('too large'));
        req.destroy();
      }
    });
    req.on('end', () => ok(body));
    req.on('error', bad);
  });
}
function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json');
function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => console.log(`Open ${url} in your browser.`));
    child.unref();
  } catch {
    console.log(`Open ${url} in your browser.`);
  }
}

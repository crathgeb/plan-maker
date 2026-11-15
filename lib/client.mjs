// Talking to running review servers from the scripts (listen.mjs, job.mjs). Node built-ins only.

import { realpathSync } from 'node:fs';
import { get, request } from 'node:http';
import { resolve, sep } from 'node:path';
import { pageHash, readRecords, scanPorts } from './servers.mjs';

export const HOST = '127.0.0.1';

const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

/** GET /api/health on a port: the parsed answer, or null. */
export function health(port, timeout = 500) {
  return new Promise((ok) => {
    const req = get({ host: HOST, port, path: '/api/health', timeout }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(b);
          ok(j.app === 'plan-maker' ? j : null);
        } catch {
          ok(null);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => ok(null));
  });
}

/** The port of the review server for this page, or null. Records first, then the usual ports. */
export async function findServer(page) {
  const want = new Set([pageHash(resolve(page)), pageHash(real(page))]);
  const mine = (h) => h && want.has(h.planHash);
  for (const r of readRecords()) {
    if (real(r.page) !== real(page)) continue;
    if (mine(await health(r.port))) return r.port;
  }
  const ports = scanPorts(); // PLAN_MAKER_SCAN: the usual ports, a range, or "off"
  const hits = await Promise.all(ports.map(async (p) => (mine(await health(p, 300)) ? p : null)));
  return hits.find(Boolean) || null;
}

/** Every running review server whose page is inside `dir`: [{ port, page }]. */
export async function serversUnder(dir) {
  const root = real(dir);
  const out = [];
  for (const r of readRecords()) {
    const p = real(r.page);
    if (p !== root && !p.startsWith(root + sep)) continue;
    if (await health(r.port)) out.push({ port: r.port, page: r.page });
  }
  return out;
}

/** A JSON request to a review server. Resolves { status, body } (body parsed when it is JSON). */
export function call(port, method, path, data) {
  return new Promise((ok, bad) => {
    const payload = data === undefined ? null : JSON.stringify(data);
    const headers = payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {};
    const req = request({ host: HOST, port, path, method, headers }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        let body = b;
        try {
          body = b ? JSON.parse(b) : null;
        } catch {}
        ok({ status: res.statusCode, body });
      });
    });
    req.on('error', bad);
    req.end(payload || undefined);
  });
}

/** Hold an SSE connection; calls onEvent(parsed) per event. Resolves when the stream ends. */
export function subscribe(port, path, onEvent, onStatus = () => {}) {
  return new Promise((done) => {
    const req = get({ host: HOST, port, path, headers: { accept: 'text/event-stream' } }, (res) => {
      onStatus(res.statusCode);
      if (res.statusCode !== 200) {
        res.resume();
        return done(res.statusCode);
      }
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = frame
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
            .join('\n');
          if (!data) continue; // a keep-alive comment
          try {
            onEvent(JSON.parse(data));
          } catch {}
        }
      });
      res.on('end', () => done(200));
      res.on('error', () => done(0));
    });
    req.on('error', () => done(0));
  });
}

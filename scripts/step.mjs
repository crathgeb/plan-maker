#!/usr/bin/env node
// Tick a guide's steps off from a Claude session ("Do it for me", lib/doit.mjs). Node built-ins only.
//
//   node step.mjs <page> done <step id> [--note "…"]   tick it: the open page shows it at once
//   node step.mjs <page> undo <step id>                untick it
//   node step.mjs <page> show                          every step, and which are done
//
// With a review server running for the page, the tick goes through it (POST /api/steps/<id>), so
// open tabs update and don't save over it. Without one, it's written to notes.json directly.

import { request } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { doneSteps, readSection, tickStep } from '../lib/doit.mjs';
import { readSteps } from '../lib/registry.mjs';
import { readRecords } from '../lib/servers.mjs';

function usage(msg) {
  if (msg) console.error(`step: ${msg}`);
  console.error('usage: node step.mjs <page> done <step id> [--note "…"] | undo <step id> | show');
  process.exit(2);
}

let parsed;
try {
  parsed = parseArgs({ allowPositionals: true, options: { note: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
} catch (err) {
  usage(err.message);
}
const { values: o, positionals: [pageArg, verb, id] } = parsed;
if (o.help || !pageArg) usage();
let page = resolve(pageArg);
if (existsSync(page) && statSync(page).isDirectory()) page = join(page, 'index.html');
if (!existsSync(page)) usage(`no such page: ${pageArg}`);
if (!['done', 'undo', 'show'].includes(verb)) usage(verb ? `unknown command ${verb}` : 'done, undo or show?');
if (verb !== 'show' && !id) usage(`${verb} which step?`);

const post = (port, path, body) =>
  new Promise((ok) => {
    const data = JSON.stringify(body);
    const req = request({ host: '127.0.0.1', port, path, method: 'POST', timeout: 5000, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => ok({ status: res.statusCode, body: b }));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => ok(null));
    req.end(data);
  });

if (verb === 'show') {
  const html = readFileSync(page, 'utf8');
  let notes = null;
  try { notes = JSON.parse(readFileSync(join(dirname(page), 'notes.json'), 'utf8')); } catch {}
  const secs = [...html.matchAll(/<section\b[^>]*\bdata-id=["']([^"']*)["']/gi)].map((m) => readSection(html, m[1])).filter((s) => s?.steps.length);
  const seen = new Set();
  for (const s of secs) {
    const done = doneSteps(s, notes);
    console.log(`${s.title} (${s.id})`);
    for (const st of s.steps) {
      seen.add(st.id);
      console.log(`  [${done.has(st.id) ? 'x' : ' '}] ${st.id}  ${st.title} (${st.who})`);
    }
  }
  for (const st of readSteps(html).filter((x) => !seen.has(x.id))) console.log(`  [${notes?.steps?.[st.id]?.done ? 'x' : ' '}] ${st.id}  ${st.title} (${st.who})`);
  process.exit(0);
}

const body = { done: verb === 'done', note: o.note || '' };
for (const rec of readRecords().filter((r) => r.page === page)) {
  const r = await post(rec.port, `/api/steps/${encodeURIComponent(id)}`, body);
  if (!r) continue;
  if (r.status === 200) {
    const { step } = JSON.parse(r.body);
    console.log(`plan-maker: ${verb === 'done' ? 'ticked' : 'unticked'} “${step.title || id}”: the open page shows it.`);
    process.exit(0);
  }
  if (r.status !== 404 || /no step/.test(r.body)) {
    console.error(`step: ${r.body}`);
    process.exit(1);
  }
}
try {
  const { step } = tickStep(page, id, body);
  console.log(`plan-maker: ${verb === 'done' ? 'ticked' : 'unticked'} “${step.title || id}” in notes.json (no review server is running for the page; it shows when the page is opened).`);
} catch (err) {
  console.error(`step: ${err.message}`);
  process.exit(1);
}

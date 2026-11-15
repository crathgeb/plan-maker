#!/usr/bin/env node
// The link between a Claude Code session and plan-maker's review servers. Node built-ins only.
//
//   node listen.mjs [--project DIR]
//       Listens to every review server whose page is inside the project (default: the git root of
//       the current folder), including servers started later (from the hub, or a link). Prints one
//       line per event: when it connects to a page, and when the reader sends their notes on one.
//       Meant for Claude Code's Monitor tool: each line wakes Claude with the job. While it's
//       connected, each page shows "Claude connected", and notes sent while no one listened are
//       offered at once. Runs until stopped.
//
//   node listen.mjs <page>
//       The same for one page. Exits after ~30 s with no server for it.
//
//   node listen.mjs <page> --state <idle|working|ready|error> [--message "…"]
//       Tells the page what Claude is doing (job.mjs start/done/fail already do this for a job).

import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { call, findServer, HOST, serversUnder, subscribe } from '../lib/client.mjs';
import { projectOf } from '../lib/registry.mjs';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));

const RETRY_MS = Number(process.env.PLAN_MAKER_LISTEN_RETRY_MS) || 2000;
const SCAN_MS = Number(process.env.PLAN_MAKER_LISTEN_SCAN_MS) || 3000;
const GIVE_UP_AFTER = 15; // tries, about 30 seconds

function usage(msg) {
  if (msg) console.error(`listen: ${msg}`);
  console.error('usage: node listen.mjs [--project DIR]\n       node listen.mjs <page>\n       node listen.mjs <page> --state <idle|working|ready|error> [--message TEXT]');
  process.exit(2);
}

let parsed;
try {
  parsed = parseArgs({ allowPositionals: true, options: { project: { type: 'string' }, state: { type: 'string' }, message: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
} catch (err) {
  usage(err.message);
}
const { values: o, positionals } = parsed;
if (o.help) usage();
if (positionals.length > 1) usage(`unexpected argument ${positionals[1]}`);
const pageOf = (p) => {
  let f = resolve(p);
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!existsSync(f)) usage(`no such page: ${p}`);
  return f;
};
const page = positionals[0] ? pageOf(positionals[0]) : null;

if (o.state) {
  if (!page) usage('--state needs the page it is about');
  const port = await findServer(page);
  if (!port) {
    console.error(`listen: no review server is serving ${page} (start it with review.mjs)`);
    process.exit(1);
  }
  const { status, body } = await call(port, 'POST', '/api/claude/state', { phase: o.state, message: o.message || '' }).catch((e) => ({ status: 0, body: e.message }));
  if (status === 204) console.log(`plan-maker: told the page that Claude is ${o.state}${o.message ? `: ${o.message}` : ''}`);
  else console.error(`listen: the server refused (${status}${body ? `: ${body}` : ''})`);
  process.exit(status === 204 ? 0 : 1);
}

const print = (line) => console.log(line);

/** Hold one page's server: print its hello once and each job; resolves when the connection drops. */
const announced = new Set();
function hold(port, key) {
  return subscribe(port, '/api/claude/events', (ev) => {
    if (ev.type === 'hello') {
      // Say so once per page; a quiet reconnect after a server restart isn't news.
      if (!announced.has(key)) print(`plan-maker: connected to "${ev.name}" at http://${HOST}:${port}/${ev.waiting ? ' (its notes are waiting)' : ''}.`);
      announced.add(key);
    } else if (ev.type === 'job') print(ev.line);
  }, (status) => {
    if (status === 403) print(`plan-maker: the server on port ${port} refused the connection (403).`);
    if (status === 404 && !announced.has(`old ${key}`)) {
      // A server from before Send to Claude: it has no events to give.
      announced.add(`old ${key}`);
      print(`plan-maker: the server for ${key} on port ${port} is an older build without Send to Claude. Restart it from this session: node ${join(SCRIPTS, 'review.mjs')} ${key} --replace (in the background), and its open tabs reconnect.`);
    }
  });
}

if (page) {
  let misses = 0;
  for (;;) {
    const port = await findServer(page);
    if (!port) {
      if (++misses >= GIVE_UP_AFTER) {
        print(`plan-maker: the review server for ${page} has stopped; no longer listening. Start it again (review.mjs) and reconnect.`);
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, RETRY_MS));
      continue;
    }
    misses = 0;
    const status = await hold(port, page);
    if (status === 404) process.exit(1); // an older server: the line above says what to do
    await new Promise((r) => setTimeout(r, RETRY_MS));
  }
}

// Every page in the project: connect to each server as it appears, drop it when it goes.
const project = projectOf(resolve(o.project || process.cwd()) + '/x');
const held = new Map(); // "port page" → true while connected
print(`plan-maker: listening for notes on every page under ${project}.`);
for (;;) {
  for (const { port, page: p } of await serversUnder(project)) {
    const key = `${port} ${p}`;
    if (held.has(key)) continue;
    held.set(key, true);
    hold(port, p).then(() => held.delete(key));
  }
  await new Promise((r) => setTimeout(r, SCAN_MS));
}

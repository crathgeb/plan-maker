#!/usr/bin/env node
// Report on a job from the Claude Code session working it. Node built-ins only.
//
//   node job.mjs <page> start <job-id>                  before the worker starts: the page shows "Claude is writing v<N+1>"
//   node job.mjs <page> done  <job-id> --summary "…"    the page reloads into the new version, with the summary
//   node job.mjs <page> fail  <job-id> --error "…"      the page unlocks and says why
//   node job.mjs <page> list                            the page's jobs, newest first
//   node job.mjs <page> pack  <job-id>                  print the job's context pack
//
// Goes through the page's review server when it runs (so the page updates at once); otherwise
// edits the job files directly.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { call, findServer } from '../lib/client.mjs';
import { describeTally, failJob, finishJob, loadJob, loadJobs, packFile, startJob } from '../lib/jobs.mjs';

const USAGE = 'usage: node job.mjs <page> <start|done|fail|pack> <job-id> [--summary S] [--error E]\n       node job.mjs <page> list';
function fail(msg, code = 1) {
  console.error(`job: ${msg}`);
  process.exit(code);
}

let parsed;
try {
  parsed = parseArgs({ allowPositionals: true, options: { summary: { type: 'string' }, error: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
} catch (err) {
  fail(`${err.message}\n${USAGE}`, 2);
}
const { values: o, positionals: [pageArg, verb, id] } = parsed;
if (o.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!pageArg || !verb) fail(USAGE, 2);
let page = resolve(pageArg);
if (existsSync(page) && statSync(page).isDirectory()) page = join(page, 'index.html');
if (!existsSync(page)) fail(`no such page: ${pageArg}`, 2);

if (verb === 'list') {
  const jobs = loadJobs(page).reverse();
  if (!jobs.length) console.log('No jobs yet.');
  for (const j of jobs) console.log(`${j.id}  ${j.status.padEnd(9)}  v${j.version}  ${j.kind === 'run' ? `run “${j.step?.title}”` : describeTally(j.asks || {})}${j.summary ? `  — ${j.summary}` : ''}${j.error ? `  — ${j.error}` : ''}`);
  process.exit(0);
}
if (!['start', 'done', 'fail', 'pack'].includes(verb)) fail(`unknown action ${verb}\n${USAGE}`, 2);
if (!id) fail(`which job? ${USAGE}`, 2);
if (verb === 'pack') {
  if (!loadJob(page, id)) fail(`no job ${id}`);
  process.stdout.write(readFileSync(packFile(page, id), 'utf8'));
  process.exit(0);
}
if (verb === 'done' && !o.summary) console.error('job: no --summary; the page will say it is done without one');

const body = verb === 'done' ? { summary: o.summary || '' } : verb === 'fail' ? { error: o.error || '' } : {};
let job;
const port = await findServer(page);
if (port) {
  const { status, body: out } = await call(port, 'POST', `/api/jobs/${id}/${verb}`, body).catch((err) => fail(`the server didn't answer: ${err.message}`));
  if (status !== 200) fail(typeof out === 'string' ? out : JSON.stringify(out));
  job = out;
} else {
  try {
    job = verb === 'start' ? startJob(page, id) : verb === 'done' ? finishJob(page, id, body) : failJob(page, id, body);
  } catch (err) {
    fail(err.message);
  }
}
console.log(`job: ${job.id} is ${job.status}${job.summary ? `: ${job.summary}` : ''}${job.error ? `: ${job.error}` : ''}`);

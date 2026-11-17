// Rounds handed to Claude: the job queue on disk, and each job's context pack.
// Node built-ins only. See docs/claude-backend.md.
//
// Two kinds of job:
//   round  the reader pressed Send to Claude: "write the next version of this page from its notes".
//          While one is active the page is locked, so the notes Claude works from can't change.
//   run    the reader pressed Run it on one of Claude's steps or phases: "do your part now". The
//          page isn't locked; Claude marks the step doing, does the work, and marks it done.
// A page has at most one active job (queued, offered or running), of either kind. A Claude Code session hears of the job through scripts/listen.mjs, claims it
// (scripts/job.mjs start), hands its context pack to a background subagent, and closes it
// (job.mjs done | fail). The pack is the whole interface: a worker needs nothing else.
//
// Jobs live outside the project, so they never end up in a repo:
//   <home>/jobs/<page hash>/<id>.json    the job record
//   <home>/jobs/<page hash>/<id>.md      its context pack
//   <home>/jobs/<page hash>/log.jsonl    one line per event
// (<home> is ~/.plan-maker, or $PLAN_MAKER_HOME.) These functions are synchronous: the review
// server runs them one at a time, and job.mjs uses them directly only when no server is running.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readKind } from './kinds.mjs';
import { home, readPhases, readSteps } from './registry.mjs';
import { pageHash } from './servers.mjs';
import { currentVersion, readJson } from './versions.mjs';

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const STATUSES = ['queued', 'offered', 'running', 'done', 'failed', 'cancelled'];
/** A job in one of these is the page's one job; a round in one of these holds the page's notes. */
export const ACTIVE = new Set(['queued', 'offered', 'running']);
export const KINDS = ['round', 'run'];
/** Does this job lock the page's notes? Only a round does. */
export const locks = (job) => !!job && ACTIVE.has(job.status) && (job.kind || 'round') === 'round';

export const jobsDir = (page) => join(home(), 'jobs', pageHash(resolve(page)));
export const jobFile = (page, id) => join(jobsDir(page), `${id}.json`);
export const packFile = (page, id) => join(jobsDir(page), `${id}.md`);
const ID = /^j_[a-z0-9]+$/;

const nowIso = () => new Date().toISOString();
const newId = () => 'j_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fail = (msg, status) => Object.assign(new Error(msg), { status });

function writeJsonAtomic(file, obj) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  renameSync(tmp, file);
}

export function logEvent(page, ev) {
  try {
    mkdirSync(jobsDir(page), { recursive: true });
    appendFileSync(join(jobsDir(page), 'log.jsonl'), JSON.stringify({ at: nowIso(), ...ev }) + '\n');
  } catch {}
}

/** Every job of a page, oldest first. */
export function loadJobs(page) {
  const d = jobsDir(page);
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => /^j_[a-z0-9]+\.json$/.test(f))
    .map((f) => readJson(join(d, f)))
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
}
export const loadJob = (page, id) => (ID.test(id || '') ? readJson(jobFile(page, id)) : null);
export const saveJob = (page, job) => writeJsonAtomic(jobFile(page, job.id), job);
/** The page's active job, if any (there is at most one). */
export const activeJob = (page) => loadJobs(page).find((j) => ACTIVE.has(j.status)) || null;

// ---------- what the notes ask for ----------

const has = (x) => !!(x && (x.note || x.kind === 'detail' || x.kind === 'guide'));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** What a page's notes ask of Claude, counted: { comments, questions, details, guides, marks, decisions, general, total }. */
export function tally(notes) {
  const n = notes && typeof notes === 'object' ? notes : {};
  const written = [...(n.highlights || []), ...Object.values(n.items || {}), ...(n.drawings || [])].filter(has);
  const by = (k) => written.filter((x) => x.kind === k).length;
  const t = {
    questions: by('question'),
    details: by('detail'),
    guides: by('guide'),
    marks: (n.drawings || []).filter((d) => !d.note).length,
    decisions: Object.values(n.decisions || {}).filter((d) => d && d.choice).length,
    general: !!String(n.general || '').trim(),
  };
  t.comments = written.length - t.questions - t.details - t.guides;
  t.total = written.length + t.marks + t.decisions + (t.general ? 1 : 0);
  return t;
}

/** "3 comments, 1 question, 2 decisions" (or "no notes"). */
export function describeTally(t) {
  const parts = [];
  if (t.comments) parts.push(plural(t.comments, 'comment'));
  if (t.questions) parts.push(plural(t.questions, 'question'));
  if (t.details) parts.push(`${t.details} more detail`);
  if (t.guides) parts.push(plural(t.guides, 'guide') + ' requested');
  if (t.marks) parts.push(plural(t.marks, 'mark'));
  if (t.decisions) parts.push(plural(t.decisions, 'decision'));
  if (t.general) parts.push('a note on the whole page');
  return parts.join(', ') || 'no notes';
}

// ---------- the job's life ----------

/**
 * Hand the page's notes to Claude: a new job, or the active one if there already is one.
 * `message` is anything the reader adds as they send (optional).
 * Returns { job, created }.
 */
export function sendRound(page, { message = '', name = null } = {}) {
  page = resolve(page);
  const existing = activeJob(page);
  if (existing?.kind === 'run') throw fail(`Claude is running “${existing.step.title}”: send your notes when it’s done`, 409);
  if (existing) return { job: existing, created: false };
  const html = readFileSync(page, 'utf8');
  const notesPath = join(dirname(page), 'notes.json');
  const notes = readJson(notesPath);
  const version = currentVersion(page, html);
  const job = {
    id: newId(),
    kind: 'round',
    page,
    pageKind: readKind(html),
    name: name || pageTitle(html) || 'this page',
    version,
    next: version + 1,
    status: 'queued',
    message: String(message || '').trim().slice(0, 4000),
    asks: tally(notes),
    createdAt: nowIso(),
    offeredAt: null,
    startedAt: null,
    doneAt: null,
    summary: '',
    error: '',
  };
  saveJob(page, job);
  writePack(page, job);
  logEvent(page, { type: 'job created', job: job.id, version, asks: job.asks });
  return { job, created: true };
}

/** One of Claude's steps or phases on the page, by id: { id, title, unit, status, who }, or null. */
export function claudeStep(html, id) {
  const u = [...readPhases(html), ...readSteps(html)].find((x) => x.id === id);
  return u ? { id: u.id, title: u.title || u.id, unit: u.unit, status: u.status, who: u.who } : null;
}

/**
 * The reader pressed Run it on one of Claude's steps or phases: a job for Claude to do it now.
 * Returns { job, created }: the same job again if that step is already waiting or running.
 */
export function runStep(page, { step: id, message = '', name = null } = {}) {
  page = resolve(page);
  const html = readFileSync(page, 'utf8');
  const step = claudeStep(html, String(id || ''));
  if (!step) throw fail(`no step or phase ${id} on this page`, 404);
  if (step.who !== 'claude') throw fail(`“${step.title}” is yours, not Claude’s`, 400);
  if (step.status === 'done') throw fail(`“${step.title}” is already done`, 409);
  const existing = activeJob(page);
  if (existing?.kind === 'run' && existing.step?.id === step.id) return { job: existing, created: false };
  if (existing) throw fail(existing.kind === 'run' ? `Claude is running “${existing.step.title}”: run this one when it’s done` : 'Claude has your notes: run this when the new version is in', 409);
  const version = currentVersion(page, html);
  const job = {
    id: newId(),
    kind: 'run',
    page,
    pageKind: readKind(html),
    name: name || pageTitle(html) || 'this page',
    version,
    step: { id: step.id, title: step.title, unit: step.unit },
    status: 'queued',
    message: String(message || '').trim().slice(0, 4000),
    createdAt: nowIso(),
    offeredAt: null,
    startedAt: null,
    doneAt: null,
    summary: '',
    error: '',
  };
  saveJob(page, job);
  writePack(page, job);
  logEvent(page, { type: 'job created', kind: 'run', job: job.id, step: step.id });
  return { job, created: true };
}

export function startJob(page, id) {
  const job = loadJob(page, id);
  if (!job) throw fail(`no job ${id}`, 404);
  if (!ACTIVE.has(job.status)) throw fail(`job ${id} is already ${job.status}`, 409);
  job.status = 'running';
  job.startedAt = job.startedAt || nowIso();
  saveJob(page, job);
  logEvent(page, { type: 'job started', job: id });
  return job;
}

export function finishJob(page, id, { summary = '' } = {}) {
  const job = loadJob(page, id);
  if (!job) throw fail(`no job ${id}`, 404);
  if (job.status === 'done') return job;
  if (job.status === 'cancelled') throw fail(`job ${id} was cancelled`, 409);
  job.status = 'done';
  job.doneAt = nowIso();
  job.summary = String(summary || '').replace(/^SUMMARY:\s*/i, '').trim().slice(0, 500);
  job.error = '';
  job.version = currentVersion(page);
  saveJob(page, job);
  logEvent(page, { type: 'job done', job: id, summary: job.summary, version: job.version });
  return job;
}

/** Claude couldn't finish: the page unlocks, and the reader can send again. */
export function failJob(page, id, { error = '' } = {}) {
  const job = loadJob(page, id);
  if (!job) throw fail(`no job ${id}`, 404);
  job.status = 'failed';
  job.doneAt = nowIso();
  job.error = String(error || 'Claude couldn’t finish').trim().slice(0, 800);
  saveJob(page, job);
  logEvent(page, { type: 'job failed', job: id, error: job.error });
  return job;
}

/** The reader takes the notes back before Claude has started on them. */
export function cancelJob(page, id) {
  const job = loadJob(page, id);
  if (!job) throw fail(`no job ${id}`, 404);
  if (job.status === 'running') throw fail(job.kind === 'run' ? 'Claude has already started on it' : 'Claude has already started on these notes', 409);
  if (!ACTIVE.has(job.status)) return job;
  job.status = 'cancelled';
  job.doneAt = nowIso();
  saveJob(page, job);
  logEvent(page, { type: 'job cancelled', job: id });
  return job;
}

// ---------- the context pack ----------

function pageTitle(html) {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '';
  return t.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || null;
}

export function writePack(page, job) {
  const file = packFile(page, job.id);
  mkdirSync(jobsDir(page), { recursive: true });
  writeFileSync(file, contextPack(page, job));
  return file;
}

/** Everything Claude needs to do one of its steps, with absolute paths throughout. */
function runPack(page, job) {
  const P = PLUGIN_ROOT;
  const notesPath = join(dirname(page), 'notes.json');
  const unit = job.step.unit === 'phase' ? 'phase' : 'step';
  const L = [];
  L.push(`# plan-maker job ${job.id}: run the ${unit} "${job.step.title}"`);
  L.push('');
  L.push(`The reader pressed **Run it** on Claude's ${unit} "${job.step.title}" in the ${job.pageKind} "${job.name}": it's your part of the work, and they want it done now. Do the work itself (in the project, not on the page), then mark the ${unit} done.`);
  L.push('');
  L.push('## Where');
  L.push('');
  L.push(`- Page: \`${page}\` (${job.pageKind} v${job.version}). The ${unit} is the element with \`data-id="${job.step.id}"\`.`);
  L.push(`- Notes: \`${notesPath}\`: the reader's comments on the ${unit} (\`items["${job.step.id}"]\`, and highlights inside it), and decisions they've answered.`);
  L.push(`- Project: \`${dirname(page)}\` is the page's folder; the work happens in the repo it belongs to.`);
  L.push(`- Plugin root: \`${P}\``);
  if (job.message) {
    L.push('');
    L.push('## What the reader added');
    L.push('');
    for (const line of job.message.split('\n')) L.push(`> ${line}`);
  }
  L.push('');
  L.push('## How');
  L.push('');
  L.push(`1. **Read the ${unit}** and enough of the page around it to do it as planned: what it says to do, what it depends on, the decisions taken (Questions, the Decision log) and the reader's notes on it. If an earlier ${unit} it depends on isn't done, say so and stop (FAILED, below).`);
  L.push(`2. **Mark it in progress:** set \`data-status="doing"\` on that element in the page file. Change nothing else on the page.`);
  L.push(`3. **Do the work** in the project, as the ${unit} describes. Follow the repo's own instructions (CLAUDE.md and the like). If something only the reader can decide or do comes up (a choice the plan left open, a credential, an account), ask them; if they aren't there to answer, stop rather than guess.`);
  L.push(`4. **Mark it done:** set \`data-status="done"\` on the element. If the work changed what the ${unit} says (a different approach, a follow-up), add a short line inside it saying so. Don't write a new version of the page for this, and don't snapshot it.`);
  L.push(`5. **Log it:** \`node ${join(P, 'scripts', 'registry.mjs')} update ${page} --log "${job.step.title.replace(/"/g, "'")}: done"\` (and \`--status in-progress\` if the page was \`approved\` or \`not-started\`).`);
  L.push('');
  L.push('## When you finish');
  L.push('');
  L.push(`End with one line: \`SUMMARY: <what you did, in one sentence the reader will see on the page>\`. If you couldn't finish, leave the ${unit} at \`doing\` (or set it back to \`todo\` if you changed nothing) and end with \`FAILED: <why, in one sentence>\`.`);
  L.push('');
  return L.join('\n');
}

/** Everything a fresh subagent needs to write the page's next version, with absolute paths throughout. */
export function contextPack(page, job) {
  if (job.kind === 'run') return runPack(page, job);
  const P = PLUGIN_ROOT;
  const dir = dirname(page);
  const notesPath = join(dir, 'notes.json');
  const N = job.version;
  const kindSkill = { plan: 'make-plan', guide: 'make-guide', reference: 'make-reference' }[job.pageKind] || 'make-plan';
  const L = [];
  L.push(`# plan-maker job ${job.id}: write v${N + 1} of "${job.name}"`);
  L.push('');
  L.push(`You are a background worker for plan-maker. The reader reviewed a ${job.pageKind} in the browser (comments, questions, requests for more detail${job.pageKind === 'plan' ? ', guide requests' : ''}, decisions, drawings) and pressed **Send to Claude**. Your job is one round: write the page's next version from those notes, as the process-notes skill describes. Do it on your own: no one can answer questions mid-job, so decide sensibly, and put anything only the reader can decide on the page itself (a new decision in Questions, or a row in What changed saying what's waiting on them).`);
  L.push('');
  L.push('## The page');
  L.push('');
  L.push(`- Page: \`${page}\` (${job.pageKind}, now v${N})`);
  L.push(`- Notes: \`${notesPath}\` (${describeTally(job.asks)} when sent)`);
  L.push(`- Earlier versions: \`${join(dir, 'versions')}/\``);
  L.push(`- Plugin root: \`${P}\` (wherever a skill says \`\${CLAUDE_PLUGIN_ROOT}\`, use this path)`);
  if (job.message) {
    L.push('');
    L.push('## What the reader said as they sent it');
    L.push('');
    for (const line of job.message.split('\n')) L.push(`> ${line}`);
  }
  L.push('');
  L.push('## How');
  L.push('');
  L.push(`Read \`${join(P, 'skills', 'process-notes', 'SKILL.md')}\` and follow it for this page, steps 1 to 8, with these differences:`);
  L.push('');
  L.push(`- **Step 1:** the page and notes are the ones above. Read \`${join(P, 'WRITING.md')}\` and \`${join(P, 'skills', kindSkill, 'SKILL.md')}\` too.`);
  L.push('- **Step 4:** don\'t print the table for anyone: keep it for your summary. Put each **Needs your call** item on the page (an open decision, or a "Waiting on you" row in What changed).');
  L.push(`- **Step 5:** run \`node ${join(P, 'scripts', 'snapshot.mjs')} ${page}\` before you edit the page. If it refuses, stop and report why (see the end).`);
  L.push('- **Step 6:** write and register every guide the notes ask for, as the skill says.');
  L.push(`- **Step 7:** write v${N + 1} into the live file and run \`node ${join(P, 'scripts', 'check.mjs')} ${page}\` until it passes. The reader's tab reloads by itself when you're done.`);
  L.push('- **Step 8:** update the registry as the skill says.');
  L.push('- **Step 9:** skip it. Your summary is the report.');
  L.push('');
  L.push('## Rules');
  L.push('');
  L.push('- Change only this page, its `versions/` (through snapshot.mjs), and the guides the notes ask for. Don\'t touch other pages, and don\'t edit `notes.json` yourself beyond what snapshot.mjs does.');
  L.push('- Don\'t start a review server, and don\'t open a browser: the reader already has the page open.');
  L.push('- Don\'t ask questions: there is no one to answer them.');
  L.push('');
  L.push('## When you finish');
  L.push('');
  L.push(`End your reply with one line: \`SUMMARY: <what changed in v${N + 1}, in one sentence the reader will see on the page>\`. Mention the guides you wrote and anything now waiting on the reader.`);
  L.push('');
  L.push(`If you could not finish (snapshot.mjs refused, check.mjs keeps failing, the notes are unreadable), end with \`FAILED: <why, in one sentence>\` instead, and say whether you had already snapshotted v${N}.`);
  L.push('');
  return L.join('\n');
}

/** A job as the listener prints it: what it is and the exact commands that work it. */
export function describeJob(job, pack) {
  const P = PLUGIN_ROOT;
  const cmd = `node ${join(P, 'scripts', 'job.mjs')} ${job.page}`;
  if (job.kind === 'run') {
    const unit = job.step.unit === 'phase' ? 'phase' : 'step';
    return `plan-maker: job ${job.id}: the reader pressed Run it on your ${unit} "${job.step.title}" in "${job.name}" (${job.pageKind} v${job.version}): do it now. Run \`${cmd} start ${job.id}\`, then read ${pack} and do what it says yourself, in this session, so the user can follow and answer questions. When it's done run \`${cmd} done ${job.id} --summary "<one sentence on what you did>"\` (or \`${cmd} fail ${job.id} --error "<why>"\`).`;
  }
  const said = job.message ? ` The reader added: "${job.message.replace(/\s+/g, ' ').slice(0, 160)}${job.message.length > 160 ? '…' : ''}".` : '';
  return `plan-maker: job ${job.id}: the reader sent their notes on "${job.name}" (${job.pageKind} v${job.version}: ${describeTally(job.asks)}).${said} Run \`${cmd} start ${job.id}\`, then start a background subagent with the prompt "Read ${pack} and do the job it describes.", and when it finishes run \`${cmd} done ${job.id} --summary "<its SUMMARY line>"\` (or \`${cmd} fail ${job.id} --error "<its FAILED line>"\`).`;
}

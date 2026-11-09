// The registry: one list of every plan and guide, across all projects.
//
//   ~/.plan-maker/registry.json      (or $PLAN_MAKER_HOME/registry.json)
//
// Each entry is keyed by the page's absolute path and carries what a person
// needs to tell their work apart: name, goal, description, status, the next
// action and a dated progress log. Live facts are read from the page and its
// notes.json on demand by describe(), never stored, so they can't go stale:
// the version, each owner's lane of steps (You, Claude), open decisions,
// unprocessed notes, and the reasons the plan is waiting on you.
//
// There is one kind of page, a plan. Its steps (.step[data-id]) are owned by
// you, claude or both: data-who, else a .who.you / .who.claude / .who.both tag
// inside the step (pages written as guides before plans and guides merged),
// else you. Your steps (and both) are done when notes.json has steps[id].done;
// Claude's when the step carries data-status="done" (or "doing", "todo").

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { currentVersion, readJson, snapshotNumbers } from './versions.mjs';

export const STATUSES = ['draft', 'reviewing', 'approved', 'in-progress', 'blocked', 'done', 'archived'];
export const ACTIVE = ['draft', 'reviewing', 'approved', 'in-progress', 'blocked'];

export const home = () => resolve(process.env.PLAN_MAKER_HOME || join(homedir(), '.plan-maker'));
export const registryPath = () => join(home(), 'registry.json');

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const idFor = (path) => createHash('sha256').update(resolve(path)).digest('hex').slice(0, 10);

export function load() {
  const r = readJson(registryPath());
  return r && Array.isArray(r.entries) ? r : { version: 1, entries: [] };
}

export function save(reg) {
  mkdirSync(home(), { recursive: true });
  const file = registryPath();
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n');
  renameSync(tmp, file);
}

/** A plan path as given (a file or its folder) → the absolute path of its HTML. */
export function resolvePage(p) {
  let abs = resolve(p);
  if (existsSync(abs) && statSync(abs).isDirectory()) abs = join(abs, 'index.html');
  return abs;
}

const text = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

/** What the page says about itself: title and the hero's lede. */
export function readPage(path) {
  const html = readFileSync(path, 'utf8');
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
  // The hero's lede describes the page; a later section's lede (a glossary's) doesn't.
  const hero = html.match(/<header[^>]*class=["'][^"']*\bhero\b[^>]*>([\s\S]*?)<\/header>/i)?.[1];
  const ledeIn = (s) => s?.match(/<p[^>]*class=["'][^"']*\blede\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];
  const lede = ledeIn(hero) || ledeIn(html);
  return { html, title: title ? text(title) : null, lede: lede ? text(lede) : null };
}

/** The project a page belongs to: the nearest folder with .git, else the folder holding plans/ or guides/. */
export function projectOf(path) {
  let dir = dirname(path);
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return d;
    if (dirname(d) === d) break;
  }
  const m = dir.match(/^(.*)[\\/](?:plans|guides)[\\/][^\\/]+$/);
  return m ? m[1] : dir;
}

export function find(reg, pathOrId) {
  const abs = resolvePage(pathOrId);
  return reg.entries.find((e) => e.path === abs || e.id === pathOrId) || null;
}

/**
 * Add a page, or update its entry. `fields` may set name, goal, description,
 * status and next; `log` appends a dated progress line. Returns the entry.
 */
export function upsert(reg, pathOrId, fields = {}, log = null) {
  const existing = find(reg, pathOrId);
  const path = existing ? existing.path : resolvePage(pathOrId);
  if (fields.status && !STATUSES.includes(fields.status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
  const before = existing?.status;
  let entry = existing;
  if (!entry) {
    if (!existsSync(path)) throw new Error(`no such file: ${path}`);
    const page = readPage(path);
    const project = projectOf(path);
    entry = {
      id: idFor(path),
      path,
      name: page.title || basename(dirname(path)),
      goal: '',
      description: page.lede || '',
      // A page written as a guide is followed, not reviewed.
      status: /<meta\s+name=["']pm-kind["']\s+content=["']guide["']/i.test(page.html) ? 'in-progress' : 'reviewing',
      next: '',
      project: basename(project),
      projectPath: project,
      created: today(),
      updated: today(),
      log: [],
    };
    reg.entries.push(entry);
  }
  for (const k of ['name', 'goal', 'description', 'status', 'next']) {
    if (fields[k] != null) entry[k] = String(fields[k]);
  }
  if (log) entry.log.push({ date: today(), text: String(log) });
  else if (fields.status && existing && fields.status !== before) entry.log.push({ date: today(), text: `Status → ${fields.status}` });
  entry.updated = today();
  return entry;
}

export function remove(reg, pathOrId) {
  const e = find(reg, pathOrId);
  if (!e) return null;
  reg.entries = reg.entries.filter((x) => x !== e);
  return e;
}

const OWNERS = ['you', 'claude', 'both'];

/**
 * The plan's steps, in page order: [{ id, who, status, title }].
 * who: data-who, else a .who.you / .who.claude / .who.both tag inside the step, else you.
 */
export function readSteps(html) {
  const opens = [...html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*>/gi)].filter((m) => {
    const tag = m[0];
    return /\bclass=["'][^"']*\bstep\b[^"']*["']/i.test(tag) && /\bdata-id=["'][^"']+["']/i.test(tag);
  });
  return opens.map((m, i) => {
    const tag = m[0];
    const attr = (name) => tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1] || null;
    const end = i + 1 < opens.length ? opens[i + 1].index : m.index + tag.length + 6000;
    const body = html.slice(m.index + tag.length, end);
    let who = (attr('data-who') || '').toLowerCase();
    if (!OWNERS.includes(who)) who = body.match(/class=["'][^"']*\bwho\s+(you|claude|both)\b/i)?.[1]?.toLowerCase() || 'you';
    const status = (attr('data-status') || 'todo').toLowerCase();
    const h = body.match(/<h[34]\b[^>]*>([\s\S]*?)<\/h[34]>/i)?.[1] || '';
    const title = text(h.replace(/<([a-z]+)\b[^>]*class=["'][^"']*\bwho\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, ''));
    return { id: attr('data-id'), who, status, title };
  });
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Why a described plan is waiting on you: [{ key, text }]. Done and archived plans never wait. */
export function waitingReasons(d) {
  if (d.missing || d.error || d.status === 'done' || d.status === 'archived') return [];
  const out = [];
  const reviewing = d.status === 'reviewing' || d.status === 'draft';
  if (reviewing && !d.reviewDone) out.push({ key: 'review', text: 'Review the plan' });
  if (reviewing && d.openDecisions) out.push({ key: 'decisions', text: `Answer ${plural(d.openDecisions, 'decision')}` });
  if (d.reviewDone && d.pending > 0) out.push({ key: 'process', text: 'Tell Claude “process my notes”' });
  const you = d.lanes?.you;
  if ((d.status === 'approved' || d.status === 'in-progress') && you && you.done < you.total) {
    const left = you.total - you.done;
    out.push({ key: 'steps', text: `${left} of your steps left${d.nextYouStep ? `: ${d.nextYouStep}` : ''}` });
  }
  if (d.status === 'blocked' && /^\s*you\b/i.test(d.next || '')) out.push({ key: 'blocked', text: d.next.trim() });
  return out;
}

/** An entry plus what its page and notes.json say right now. */
export function describe(entry) {
  const { kind, ...rest } = entry; // entries from before plans and guides merged carry a kind; it means nothing now
  const out = { ...rest, missing: !existsSync(entry.path) };
  if (out.missing) return { ...out, waiting: [] };
  try {
    const html = readFileSync(entry.path, 'utf8');
    const notes = readJson(join(dirname(entry.path), 'notes.json'));
    out.version = currentVersion(entry.path, html);
    out.versions = snapshotNumbers(entry.path).length + 1;
    out.modified = statSync(entry.path).mtime.toISOString();
    out.notesUpdated = notes?.updatedAt || null;

    const steps = readSteps(html);
    const lanes = { you: { done: 0, total: 0 }, claude: { done: 0, total: 0, doing: 0 } };
    let nextYouStep = null;
    for (const s of steps) {
      if (s.who === 'claude') {
        lanes.claude.total++;
        if (s.status === 'done') lanes.claude.done++;
        else if (s.status === 'doing') lanes.claude.doing++;
      } else {
        lanes.you.total++;
        if (notes?.steps?.[s.id]?.done) lanes.you.done++;
        else if (!nextYouStep) nextYouStep = s.title || s.id;
      }
    }
    out.lanes = lanes;
    out.nextYouStep = nextYouStep;

    const items = Object.values(notes?.items || {});
    const noted = [...(notes?.highlights || []), ...items, ...(notes?.drawings || [])].filter((x) => x?.note);
    out.questions = noted.filter((x) => x.kind === 'question').length;
    out.pending =
      (notes?.highlights || []).filter((h) => h.note).length +
      items.filter((i) => i.note || i.verdict).length +
      (notes?.drawings || []).length +
      Object.values(notes?.decisions || {}).filter((d) => d?.choice).length +
      (notes?.general ? 1 : 0);
    out.reviewDone = !!notes?.doneAt;
    out.openDecisions = [...html.matchAll(/<[^>]*\bdata-decision=["'][^"']+["'][^>]*>/g)].filter((m) => /class=["'][^"']*\bdecision\b/.test(m[0])).length;
  } catch (err) {
    out.error = String(err.message || err);
  }
  out.waiting = waitingReasons(out);
  return out;
}

/** When the plan last changed: the page, its notes or its entry, whichever is newest (ISO string). */
export function touched(d) {
  return [d.modified, d.notesUpdated, d.updated].filter(Boolean).sort().pop() || '';
}

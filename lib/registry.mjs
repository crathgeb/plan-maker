// The registry: one list of every plan, guide and reference, across all projects.
//
//   ~/.plan-maker/registry.json      (or $PLAN_MAKER_HOME/registry.json)
//
// Each entry is keyed by the page's absolute path and carries what a person
// needs to tell their work apart: kind, name, goal, description, status, the
// next action and a dated progress log. Live facts are read from the page and
// its notes.json on demand by describe(), never stored, so they can't go stale:
// the version, each owner's lane, open decisions, unprocessed notes, requests
// for guides and more detail, linked guides, staleness, and the reasons the
// page is waiting on you.
//
// The units of progress depend on the kind (lib/kinds.mjs):
//   plan       .phase[data-id][data-who], owned by you, claude or both. A phase
//              linked to a guide (data-guide) is done when the guide is done.
//              Pages from before kinds were split may hold .step cards instead,
//              which count the same way.
//   guide      .step[data-id], owned by data-who, else a .who.you / .who.claude /
//              .who.both tag inside the step (0.2 guides), else you.
//   reference  none. A reference lists the files it describes in
//              <meta name="pm-source">; it is stale when one changed after it.
// The reader's units (you, both) are done when notes.json has steps[id].done;
// Claude's when the element carries data-status="done" (or "doing", "todo").

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { ACTIVE, DEFAULT_STATUS, KINDS, STATUSES, readKind, readMeta, statusesFor } from './kinds.mjs';
import { currentVersion, readJson, snapshotNumbers } from './versions.mjs';

export { ACTIVE, KINDS, STATUSES, statusesFor };

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

/** A page path as given (a file or its folder) → the absolute path of its HTML. */
export function resolvePage(p) {
  let abs = resolve(p);
  if (existsSync(abs) && statSync(abs).isDirectory()) abs = join(abs, 'index.html');
  return abs;
}

const text = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

/** What the page says about itself: title, the hero's lede and its kind. */
export function readPage(path) {
  const html = readFileSync(path, 'utf8');
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
  // The hero's lede describes the page; a later section's lede (a glossary's) doesn't.
  const hero = html.match(/<header[^>]*class=["'][^"']*\bhero\b[^>]*>([\s\S]*?)<\/header>/i)?.[1];
  const ledeIn = (s) => s?.match(/<p[^>]*class=["'][^"']*\blede\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];
  const lede = ledeIn(hero) || ledeIn(html);
  return { html, title: title ? text(title) : null, lede: lede ? text(lede) : null, kind: readKind(html) };
}

/** The project a page belongs to: the nearest folder with .git, else the folder holding plans/ or guides/. */
export function projectOf(path) {
  let dir = dirname(path);
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return d;
    if (dirname(d) === d) break;
  }
  const m = dir.match(/^(.*?)[\\/](?:plans|guides|docs)[\\/].+$/);
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
  if (!existing && !existsSync(path)) throw new Error(`no such file: ${path}`);
  // The kind always comes from the page, so a page rewritten as another kind follows.
  const kind = existsSync(path) ? readKind(readFileSync(path, 'utf8')) : existing?.kind || 'plan';
  if (fields.status && !statusesFor(kind).includes(fields.status)) {
    throw new Error(`a ${kind}'s status must be one of ${statusesFor(kind).join(', ')}`);
  }
  const before = existing?.status;
  let entry = existing;
  if (!entry) {
    const page = readPage(path);
    const project = projectOf(path);
    entry = {
      id: idFor(path),
      path,
      kind,
      name: page.title || basename(dirname(path)),
      goal: '',
      description: page.lede || '',
      status: DEFAULT_STATUS[kind],
      next: '',
      project: basename(project),
      projectPath: project,
      created: today(),
      updated: today(),
      log: [],
    };
    reg.entries.push(entry);
  }
  entry.kind = kind;
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

/** Opening tags carrying data-id and the given class, with their attributes and the HTML up to the next one. */
function blocks(html, cls) {
  // Whole class names only: "phase" must not match "phase-h".
  const re = new RegExp(`\\bclass=["'](?:[^"']*\\s)?${cls}(?:\\s[^"']*)?["']`, 'i');
  const opens = [...html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*>/gi)].filter((m) => re.test(m[0]) && /\bdata-id=["'][^"']+["']/i.test(m[0]));
  return opens.map((m, i) => {
    const tag = m[0];
    const attr = (name) => tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1] ?? null;
    const end = i + 1 < opens.length ? opens[i + 1].index : m.index + tag.length + 6000;
    return { tag, attr, body: html.slice(m.index + tag.length, end), index: m.index };
  });
}

/**
 * The page's steps, in page order: [{ id, who, status, title }].
 * who: data-who, else a .who.you / .who.claude / .who.both tag inside the step, else you.
 */
export function readSteps(html) {
  return blocks(html, 'step').map(({ attr, body }) => {
    let who = (attr('data-who') || '').toLowerCase();
    if (!OWNERS.includes(who)) who = body.match(/class=["'][^"']*\bwho\s+(you|claude|both)\b/i)?.[1]?.toLowerCase() || 'you';
    const status = (attr('data-status') || 'todo').toLowerCase();
    const h = body.match(/<h[34]\b[^>]*>([\s\S]*?)<\/h[34]>/i)?.[1] || '';
    const title = text(h.replace(/<([a-z]+)\b[^>]*class=["'][^"']*\bwho\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, ''));
    return { id: attr('data-id'), who, status, title, unit: 'step' };
  });
}

/** A plan's phases, in page order: [{ id, who, status, title, guide }] (guide: the data-guide href, or null). */
export function readPhases(html) {
  // A phase has an owner. Pages from before kinds used .phase for plain blocks, without one.
  return blocks(html, 'phase').filter(({ attr }) => attr('data-who') != null).map(({ attr, body }) => {
    let who = (attr('data-who') || '').toLowerCase();
    if (!OWNERS.includes(who)) who = 'you';
    const h = body.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || '';
    return { id: attr('data-id'), who, status: (attr('data-status') || 'todo').toLowerCase(), title: text(h), guide: attr('data-guide') || null, unit: 'phase' };
  });
}

/** Where a link written in a page points, as an absolute path (null for URLs and anchors). */
export function linkTarget(pagePath, href) {
  if (!href || /^[a-z][a-z0-9+.-]*:|^#|^\/\//i.test(href)) return null;
  const clean = decodeURI(href.split('#')[0].split('?')[0]);
  if (!clean) return null;
  return resolvePage(isAbsolute(clean) ? clean : join(dirname(pagePath), clean));
}

/** How far along a guide is: { path, exists, name, you, claude, done } (done: every step done). */
export function guideProgress(path) {
  if (!existsSync(path)) return { path, exists: false, name: null, you: { done: 0, total: 0 }, claude: { done: 0, total: 0 }, done: false };
  const page = readPage(path);
  const notes = readJson(join(dirname(path), 'notes.json'));
  const lanes = laneCounts(readSteps(page.html), notes, path);
  const total = lanes.you.total + lanes.claude.total;
  return { path, exists: true, name: page.title, ...lanes, done: total > 0 && lanes.you.done + lanes.claude.done === total };
}

/** Each owner's lane over the given units, with the reader's next one. Phases linked to a guide follow it. */
function laneCounts(units, notes, pagePath, guides = null) {
  const lanes = { you: { done: 0, total: 0 }, claude: { done: 0, total: 0, doing: 0 } };
  let nextYou = null;
  for (const u of units) {
    let done;
    let doing = u.status === 'doing';
    const g = u.guide && guides ? guides[u.id] : null;
    if (u.who === 'claude') done = u.status === 'done';
    else if (g?.exists) {
      done = g.done;
      doing = !done && g.you.done + g.claude.done > 0;
    } else done = !!notes?.steps?.[u.id]?.done;
    const lane = lanes[u.who === 'claude' ? 'claude' : 'you'];
    lane.total++;
    if (done) lane.done++;
    else if (doing && u.who === 'claude') lanes.claude.doing++;
    // A phase you do through a guide waits on you there, not here.
    if (u.who !== 'claude' && !done && !g?.exists && !nextYou) nextYou = u.title || u.id;
  }
  return { ...lanes, nextYou };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Why a described page is waiting on you: [{ key, text }]. Done and archived pages never wait. */
export function waitingReasons(d) {
  if (d.missing || d.error || d.status === 'done' || d.status === 'archived') return [];
  const out = [];
  const reviewing = d.status === 'reviewing' || d.status === 'draft';
  const noun = d.kind === 'guide' ? 'guide' : d.kind === 'reference' ? 'reference' : 'plan';
  if (reviewing && !d.reviewDone) out.push({ key: 'review', text: `Review the ${noun}` });
  if (reviewing && d.openDecisions) out.push({ key: 'decisions', text: `Answer ${plural(d.openDecisions, 'decision')}` });
  const asked = d.requests?.guide || 0;
  if (asked) out.push({ key: 'process', text: `Tell Claude “process my notes” to write ${plural(asked, 'guide')}` });
  else if (d.reviewDone && d.pending > 0) out.push({ key: 'process', text: 'Tell Claude “process my notes”' });
  const you = d.lanes?.you;
  const working = ['approved', 'not-started', 'in-progress'].includes(d.status);
  if (working && you && you.done < you.total && d.nextYouStep) {
    const left = d.lanesLeftHere ?? you.total - you.done;
    const unit = d.unit === 'phase' ? 'phase' : 'step';
    if (left > 0) out.push({ key: 'steps', text: `${left} of your ${unit}s left: ${d.nextYouStep}` });
  }
  if (d.stale?.length) out.push({ key: 'stale', text: `Out of date: ${plural(d.stale.length, 'source file')} changed since it was written` });
  if (d.status === 'blocked' && /^\s*you\b/i.test(d.next || '')) out.push({ key: 'blocked', text: d.next.trim() });
  return out;
}

/** The files a reference describes that changed after it was last written: [{ file, rel }]. */
export function staleSources(path, html, project) {
  const list = (readMeta(html, 'pm-source') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) return [];
  const written = statSync(path).mtimeMs;
  const out = [];
  for (const rel of list) {
    const file = isAbsolute(rel) ? rel : join(project, rel);
    try {
      // A second's grace: a source saved in the same moment as the page isn't newer.
      if (statSync(file).mtimeMs > written + 1000) out.push({ file, rel });
    } catch {
      out.push({ file, rel, missing: true });
    }
  }
  return out;
}

/** An entry plus what its page and notes.json say right now. */
export function describe(entry) {
  const out = { ...entry, kind: entry.kind || 'plan', missing: !existsSync(entry.path) };
  if (out.missing) return { ...out, waiting: [] };
  try {
    const html = readFileSync(entry.path, 'utf8');
    const notes = readJson(join(dirname(entry.path), 'notes.json'));
    out.kind = readKind(html);
    out.version = currentVersion(entry.path, html);
    out.versions = snapshotNumbers(entry.path).length + 1;
    out.modified = statSync(entry.path).mtime.toISOString();
    out.notesUpdated = notes?.updatedAt || null;

    const parent = readMeta(html, 'pm-parent');
    out.parentPath = parent ? linkTarget(entry.path, parent) : null;
    out.parentPhase = readMeta(html, 'pm-parent-phase');

    let units = [];
    const guides = {};
    if (out.kind !== 'reference') {
      const phases = out.kind === 'plan' ? readPhases(html) : [];
      units = [...phases, ...readSteps(html)];
      for (const p of phases) {
        if (!p.guide) continue;
        const target = linkTarget(entry.path, p.guide);
        if (target) guides[p.id] = guideProgress(target);
      }
    }
    out.unit = units.length && units.every((u) => u.unit === 'phase') ? 'phase' : 'step';
    const { nextYou, ...lanes } = laneCounts(units, notes, entry.path, guides);
    out.lanes = lanes;
    out.nextYouStep = nextYou;
    // Your units here that aren't handed to a guide: the ones a "steps left" reason should count.
    out.lanesLeftHere = units.filter((u) => u.who !== 'claude' && !guides[u.id]?.exists && !notes?.steps?.[u.id]?.done).length;
    out.guides = Object.entries(guides).map(([phase, g]) => ({ phase, path: g.path, exists: g.exists, name: g.name, done: g.done, you: g.you, claude: g.claude }));

    const items = Object.values(notes?.items || {});
    const requested = (k) => items.filter((i) => i?.kind === k).length + (notes?.highlights || []).filter((h) => h?.kind === k).length;
    out.requests = { guide: requested('guide'), detail: requested('detail') };
    const noted = [...(notes?.highlights || []), ...items, ...(notes?.drawings || [])].filter((x) => x?.note);
    out.questions = noted.filter((x) => x.kind === 'question').length;
    out.pending =
      (notes?.highlights || []).filter((h) => h.note || h.kind === 'detail').length +
      items.filter((i) => i.note || i.verdict || i.kind === 'guide' || i.kind === 'detail').length +
      (notes?.drawings || []).length +
      Object.values(notes?.decisions || {}).filter((d) => d?.choice).length +
      (notes?.general ? 1 : 0);
    out.reviewDone = !!notes?.doneAt;
    out.openDecisions = [...html.matchAll(/<[^>]*\bdata-decision=["'][^"']+["'][^>]*>/g)].filter((m) => /class=["'][^"']*\bdecision\b/.test(m[0])).length;
    out.stale = out.kind === 'reference' ? staleSources(entry.path, html, entry.projectPath || projectOf(entry.path)).map((s) => s.rel) : [];
  } catch (err) {
    out.error = String(err.message || err);
  }
  out.waiting = waitingReasons(out);
  return out;
}

/** When the page last changed: the page, its notes or its entry, whichever is newest (ISO string). */
export function touched(d) {
  return [d.modified, d.notesUpdated, d.updated].filter(Boolean).sort().pop() || '';
}

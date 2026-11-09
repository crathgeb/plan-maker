// Plan versions: the live plan plus read-only snapshots of every earlier
// version, each with the notes the user wrote on it.
//
//   plans/<slug>/index.html            the live plan (current version)
//   plans/<slug>/notes.json            notes on the current version, in progress
//   plans/<slug>/versions/v1.html      v1 exactly as it was reviewed
//   plans/<slug>/versions/v1.notes.json  the notes written on v1
//
// notes-v<N>.json beside the plan (plan-maker 0.1) is read as v<N>'s notes.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const META = (name) => new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([^"']*)["']`, 'i');

/** The version a plan's HTML declares: <meta name="plan-version">, else "Plan v<N>" in its text. */
export function readVersion(html) {
  const m = html.match(META('plan-version')) || html.match(/\bPlan v(\d+)\b/);
  const n = m ? parseInt(m[1], 10) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function readDate(html) {
  return html.match(META('plan-date'))?.[1] || null;
}

/** A page that carries its own review script (an older plan, saved as it was). */
export function isLegacy(html) {
  return !html.includes('<script data-plan-maker') && /['"`]\/api\/notes['"`]/.test(html);
}

export const versionsDir = (planPath) => join(dirname(planPath), 'versions');
export const snapshotPath = (planPath, n) => join(versionsDir(planPath), `v${n}.html`);

/** Where version n's notes are archived: versions/v<n>.notes.json, else the 0.1 name notes-v<n>.json. */
export function snapshotNotesPath(planPath, n) {
  const current = join(versionsDir(planPath), `v${n}.notes.json`);
  const legacy = join(dirname(planPath), `notes-v${n}.json`);
  if (existsSync(current)) return current;
  if (existsSync(legacy)) return legacy;
  return null;
}

export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Snapshot numbers on disk, ascending. */
export function snapshotNumbers(planPath) {
  const dir = versionsDir(planPath);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => f.match(/^v(\d+)\.html$/))
    .filter(Boolean)
    .map((m) => parseInt(m[1], 10))
    .sort((a, b) => a - b);
}

/** The live plan's version: what it declares, else one past the newest snapshot. */
export function currentVersion(planPath, html = readFileSync(planPath, 'utf8')) {
  const declared = readVersion(html);
  if (declared) return declared;
  const snaps = snapshotNumbers(planPath);
  return snaps.length ? snaps[snaps.length - 1] + 1 : 1;
}

export function summarize(notes) {
  if (!notes) return '';
  const items = Object.values(notes.items || {});
  const written = [...(notes.highlights || []), ...items, ...(notes.drawings || [])].filter((x) => x && x.note);
  const q = written.filter((x) => x.kind === 'question').length;
  const marks = (notes.drawings || []).filter((d) => !d.note).length;
  const cut = items.filter((i) => i.verdict === 'cut').length;
  const change = items.filter((i) => i.verdict === 'change').length;
  const decided = Object.values(notes.decisions || {}).filter((d) => d && d.choice).length;
  const done = Object.values(notes.steps || {}).filter((s) => s && s.done).length;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const parts = [plural(written.length - q, 'comment')];
  if (q) parts.push(plural(q, 'question'));
  if (marks) parts.push(plural(marks, 'mark'));
  if (change) parts.push(`${change} change`);
  if (cut) parts.push(`${cut} cut`);
  if (decided) parts.push(`${decided} decided`);
  if (done) parts.push(`${done} done`);
  return parts.join(' · ');
}

/**
 * Every version, newest first: [{ version, current, file, notesFile, date, summary }].
 * `date` is the plan's <meta name="plan-date">, else when its notes were last saved, else the file's mtime.
 */
export function listVersions(planPath) {
  const html = readFileSync(planPath, 'utf8');
  const current = currentVersion(planPath, html);
  const notesPath = join(dirname(planPath), 'notes.json');
  const out = [
    {
      version: current,
      current: true,
      file: planPath,
      notesFile: existsSync(notesPath) ? notesPath : null,
      date: readDate(html) || statSync(planPath).mtime.toISOString(),
      summary: summarize(existsSync(notesPath) ? readJson(notesPath) : null),
    },
  ];
  for (const n of snapshotNumbers(planPath).reverse()) {
    if (n === current) continue; // a snapshot of the live version adds nothing to the list
    const file = snapshotPath(planPath, n);
    const notesFile = snapshotNotesPath(planPath, n);
    const notes = notesFile ? readJson(notesFile) : null;
    out.push({
      version: n,
      current: false,
      file,
      notesFile,
      date: readDate(readFileSync(file, 'utf8')) || notes?.doneAt || notes?.updatedAt || statSync(file).mtime.toISOString(),
      summary: summarize(notes),
    });
  }
  return out;
}

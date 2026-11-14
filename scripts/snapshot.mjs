#!/usr/bin/env node
// Saves the live plan as a read-only version before it is revised.
// Node built-ins only.
//
//   node snapshot.mjs <plan.html | plan-dir>
//
// Copies the plan to versions/v<N>.html and moves its notes (notes.json, or
// the 0.1 archive notes-v<N>.json) to versions/v<N>.notes.json, where N is the
// plan's current version. Never overwrites a snapshot: running it twice is
// harmless, and it stops with an error if a different v<N> is already saved.
// Exit codes: 0 saved (or already saved), 1 refused, 2 usage.

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { currentVersion, readJson, readVersion, snapshotPath, versionsDir } from '../lib/versions.mjs';

const show = (p) => relative(process.cwd(), p).split(sep).join('/') || '.';
const fail = (msg, code = 1) => {
  console.error(`snapshot: ${msg}`);
  process.exit(code);
};

const arg = process.argv[2];
if (!arg || arg.startsWith('-')) fail('usage: node snapshot.mjs <plan.html | plan-dir>', 2);
let planPath = resolve(arg);
if (existsSync(planPath) && statSync(planPath).isDirectory()) planPath = join(planPath, 'index.html');
if (!existsSync(planPath)) fail(`no such file: ${arg}`, 2);

const html = readFileSync(planPath, 'utf8');
const n = currentVersion(planPath, html);
if (!readVersion(html)) console.log(`snapshot: the plan declares no version; treating it as v${n}`);

const snap = snapshotPath(planPath, n);
const snapNotes = join(versionsDir(planPath), `v${n}.notes.json`);
mkdirSync(versionsDir(planPath), { recursive: true });

// 1. The plan.
if (existsSync(snap)) {
  if (readFileSync(snap, 'utf8') !== html) {
    fail(
      `${show(snap)} already exists and differs from ${show(planPath)}. ` +
        `If you have already started writing v${n + 1}, set <meta name="plan-version" content="${n + 1}"> ` +
        `(and the hero's "Plan v${n + 1}") before going on. Snapshots are never overwritten.`,
    );
  }
  console.log(`snapshot: v${n} was already saved as ${show(snap)}`);
} else {
  copyFileSync(planPath, snap, 1 /* COPYFILE_EXCL */);
  console.log(`snapshot: saved v${n} as ${show(snap)}`);
}

// 2. Its notes.
const candidates = [join(dirname(planPath), 'notes.json'), join(dirname(planPath), `notes-v${n}.json`)];
const src = candidates.find((p) => existsSync(p));
if (!src) {
  console.log(existsSync(snapNotes) ? `snapshot: v${n}'s notes are in ${show(snapNotes)}` : `snapshot: no notes for v${n}`);
} else {
  const notes = readJson(src);
  if (!notes) fail(`${show(src)} is not valid JSON; fix or remove it first`);
  const declared = notes.planVersion != null ? parseInt(notes.planVersion, 10) : null;
  if (declared && declared !== n) {
    fail(`${show(src)} holds notes on v${declared}, but the plan is v${n}. Move it aside by hand.`);
  }
  if (existsSync(snapNotes)) {
    if (readFileSync(snapNotes, 'utf8') !== readFileSync(src, 'utf8')) {
      fail(`${show(snapNotes)} already exists and differs from ${show(src)}. Snapshots are never overwritten.`);
    }
    unlinkSync(src);
    console.log(`snapshot: v${n}'s notes were already in ${show(snapNotes)}; removed the duplicate ${show(src)}`);
  } else {
    copyFileSync(src, snapNotes, 1 /* COPYFILE_EXCL */);
    unlinkSync(src);
    console.log(`snapshot: moved ${show(src)} to ${show(snapNotes)}`);
  }
  // The reader's progress is not feedback: it carries over, so the next version
  // opens with the same steps ticked off. Questions and notes stay with v<N>.
  const done = Object.fromEntries(Object.entries(notes.steps || {}).filter(([, s]) => s && s.done));
  if (Object.keys(done).length) {
    const next = join(dirname(planPath), 'notes.json');
    writeFileSync(next, JSON.stringify({ version: 1, planVersion: String(n + 1), steps: done, general: '', items: {}, highlights: [], decisions: {}, drawings: [] }, null, 2) + '\n');
    console.log(`snapshot: carried ${Object.keys(done).length} done step(s) into ${show(next)} for v${n + 1}`);
  }
}

console.log(`snapshot: now write v${n + 1} into ${show(planPath)}`);

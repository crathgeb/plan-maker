#!/usr/bin/env node
// Writes a self-contained copy of a plan with the annotation layer inlined, for
// sharing or opening straight from disk. Without the review server the page
// saves in the browser and offers "Download notes.json". Node built-ins only.
//
//   node bundle.mjs <plan.html> [-o out.html] [--with-notes] [--all-versions]
//
// --with-notes    start the copy from the plan's current notes.json
// --all-versions  also write each earlier version (versions/v<N>.html) as
//                 <out>.v<N>.html, read-only with its notes, linked by the
//                 version switcher
// Default output: <plan-dir>/<name>.review.html
//
// Images and stylesheets the plan links to are not inlined.

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { hasLayer, inject, readLayer } from '../lib/inject.mjs';
import { currentVersion, isLegacy, listVersions, readJson } from '../lib/versions.mjs';

function usage(msg) {
  if (msg) console.error(`bundle: ${msg}`);
  console.error('usage: node bundle.mjs <plan.html> [-o out.html] [--with-notes] [--all-versions]');
  process.exit(2);
}

const argv = process.argv.slice(2);
let planArg = null;
let out = null;
let withNotes = false;
let allVersions = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '-o' || a === '--out') out = argv[++i];
  else if (a === '--with-notes') withNotes = true;
  else if (a === '--all-versions') allVersions = true;
  else if (a === '-h' || a === '--help') usage();
  else if (a.startsWith('-')) usage(`unknown option ${a}`);
  else if (!planArg) planArg = a;
  else usage(`unexpected argument ${a}`);
}
if (!planArg) usage('which plan? pass the path to its HTML file');

let planPath = resolve(planArg);
if (existsSync(planPath) && statSync(planPath).isDirectory()) planPath = join(planPath, 'index.html');
if (!existsSync(planPath)) usage(`no such file: ${planArg}`);
const html = readFileSync(planPath, 'utf8');
if (hasLayer(html)) usage(`${planArg} already contains the annotation layer`);

const outPath = resolve(out || join(dirname(planPath), basename(planPath, extname(planPath)) + '.review.html'));
const posix = (p) => p.split(sep).join('/');
const current = currentVersion(planPath, html);
const config = {
  mode: 'standalone',
  version: current,
  plan: posix(relative(process.cwd(), planPath)),
  notesPath: posix(relative(process.cwd(), join(dirname(planPath), 'notes.json'))),
};
if (withNotes) {
  const notesPath = join(dirname(planPath), 'notes.json');
  if (!existsSync(notesPath)) usage(`--with-notes: no notes.json next to ${planArg}`);
  config.notes = JSON.parse(readFileSync(notesPath, 'utf8'));
}

const layer = readLayer();
const written = [outPath];
if (allVersions) {
  const versions = listVersions(planPath);
  const fileFor = (v) => (v.current ? outPath : outPath.replace(/(\.html?)?$/i, `.v${v.version}.html`));
  const list = versions.map((v) => ({ version: v.version, current: v.current, href: basename(fileFor(v)), date: v.date, summary: v.summary }));
  config.versions = list;
  config.currentHref = basename(outPath);
  for (const v of versions.filter((x) => !x.current)) {
    const snap = readFileSync(v.file, 'utf8');
    const legacy = isLegacy(snap);
    const cfg = {
      ...config,
      readOnly: true,
      legacy,
      version: v.version,
      current,
      notes: v.notesFile ? readJson(v.notesFile) : null,
    };
    writeFileSync(fileFor(v), inject(snap, cfg, layer));
    written.push(fileFor(v));
  }
}
writeFileSync(outPath, inject(html, config, layer));
for (const f of written) console.log(`plan-maker: wrote ${posix(relative(process.cwd(), f))}`);

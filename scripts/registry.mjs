#!/usr/bin/env node
// The plan registry: every plan and guide you have, across projects, in
// ~/.plan-maker/registry.json (or $PLAN_MAKER_HOME). Node built-ins only.
//
//   node registry.mjs add <page> [--name N] [--goal G] [--description D] [--status S] [--next X] [--log "text"]
//   node registry.mjs update <page|id> [same options]     (adds it if it isn't registered yet)
//   node registry.mjs list [--all] [--project NAME] [--json]
//   node registry.mjs show <page|id>
//   node registry.mjs remove <page|id>
//   node registry.mjs scan [dir]      register every plan-maker page under dir (default .): HTML with plan-version or pm-kind
//   node registry.mjs prune           drop entries whose page no longer exists
//
// Statuses: draft, reviewing, approved, in-progress, blocked, done, archived.
// Name and description default to what the page says (<title>, the hero's
// lede). Version, each owner's steps, open decisions and the reasons a plan is
// waiting on you are read live from the page and its notes.json.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { ACTIVE, STATUSES, describe, find, load, registryPath, remove, save, touched, upsert } from '../lib/registry.mjs';

const fail = (msg, code = 1) => {
  console.error(`registry: ${msg}`);
  process.exit(code);
};
const USAGE = `usage: node registry.mjs <add|update|list|show|remove|scan|prune> …
  add <page> [--name N] [--goal G] [--description D] [--status S] [--next X] [--log TEXT]
  update <page|id> [same options]
  list [--all] [--project NAME] [--json]
  show <page|id>
  remove <page|id>
  scan [dir]
  prune
statuses: ${STATUSES.join(', ')}`;

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === '-h' || cmd === '--help') fail(USAGE, cmd ? 0 : 2);

const FIELDS = ['name', 'goal', 'description', 'status', 'next', 'log', 'project'];
const opts = {};
const args = [];
const flags = new Set();
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  const m = a.match(/^--([a-z]+)(?:=(.*))?$/s);
  if (!m) args.push(a);
  else if (['all', 'json'].includes(m[1])) flags.add(m[1]);
  else if (FIELDS.includes(m[1])) {
    const v = m[2] ?? rest[++i];
    if (v == null) fail(`--${m[1]} needs a value`, 2);
    opts[m[1]] = v;
  } else fail(`unknown option ${a}\n${USAGE}`, 2);
}

const show = (p) => {
  const r = relative(process.cwd(), p);
  return r && !r.startsWith('..') ? r.split(sep).join('/') : p;
};

function line(d) {
  let facts;
  if (d.missing) facts = 'page missing';
  else if (d.error) facts = d.error;
  else {
    const parts = [`v${d.version}`];
    if (d.lanes.you.total) parts.push(`you ${d.lanes.you.done}/${d.lanes.you.total}`);
    if (d.lanes.claude.total) parts.push(`claude ${d.lanes.claude.done}/${d.lanes.claude.total}${d.lanes.claude.doing ? ` (${d.lanes.claude.doing} in progress)` : ''}`);
    if (d.openDecisions) parts.push(`${d.openDecisions} open decision${d.openDecisions === 1 ? '' : 's'}`);
    facts = parts.join(' · ');
  }
  const out = [`  ${d.waiting.length ? '●' : ' '} ${d.name}  (${d.status})  ${facts}`];
  out.push(`      ${d.goal || '(no goal set)'}`);
  for (const w of d.waiting) out.push(`      waiting on you: ${w.text}`);
  out.push(`      ${show(d.path)}  id ${d.id}`);
  return out.join('\n');
}

const reg = load();

switch (cmd) {
  case 'add':
  case 'update': {
    if (args.length !== 1) fail(`${cmd} needs one page path or id\n${USAGE}`, 2);
    const { log, project, ...fields } = opts;
    const was = find(reg, args[0]);
    try {
      const e = upsert(reg, args[0], fields, log);
      save(reg);
      console.log(`registry: ${was ? 'updated' : 'registered'} "${e.name}" (${e.status})  id ${e.id}`);
    } catch (err) {
      fail(err.message);
    }
    break;
  }
  case 'list': {
    let list = reg.entries.map(describe);
    if (!flags.has('all')) list = list.filter((d) => ACTIVE.includes(d.status));
    if (opts.project) list = list.filter((d) => d.project === opts.project);
    // Waiting on you first, then most recently touched.
    list.sort((a, b) => (b.waiting.length > 0) - (a.waiting.length > 0) || touched(b).localeCompare(touched(a)));
    if (flags.has('json')) {
      console.log(JSON.stringify(list, null, 2));
      break;
    }
    if (!list.length) {
      console.log(reg.entries.length ? 'registry: nothing active (use --all to see done and archived)' : `registry: empty (${registryPath()})`);
      break;
    }
    const projects = [...new Set(list.map((d) => d.project))];
    for (const p of projects) {
      const group = list.filter((d) => d.project === p);
      const waiting = group.filter((d) => d.waiting.length).length;
      console.log(`\n${p} (${group.length}${waiting ? `, ${waiting} waiting on you` : ''})`);
      for (const d of group) console.log(line(d));
    }
    break;
  }
  case 'show': {
    if (args.length !== 1) fail('show needs one page path or id', 2);
    const e = find(reg, args[0]);
    if (!e) fail(`not registered: ${args[0]}`);
    console.log(JSON.stringify(describe(e), null, 2));
    break;
  }
  case 'remove': {
    if (args.length !== 1) fail('remove needs one page path or id', 2);
    const e = remove(reg, args[0]);
    if (!e) fail(`not registered: ${args[0]}`);
    save(reg);
    console.log(`registry: removed "${e.name}" (the page itself is untouched)`);
    break;
  }
  case 'scan': {
    // Every plan-maker page under dir: HTML declaring plan-version or pm-kind,
    // skipping snapshots (versions/), shared bundles (*.review*.html) and dependency folders.
    const root = resolve(args[0] || '.');
    const SKIP = new Set(['node_modules', 'versions', 'dist', 'build', 'vendor']);
    const found = [];
    const walk = (dir, depth) => {
      let names;
      try { names = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const d of names) {
        if (d.name.startsWith('.')) continue;
        const p = join(dir, d.name);
        if (d.isDirectory()) { if (depth < 6 && !SKIP.has(d.name)) walk(p, depth + 1); continue; }
        if (!d.isFile() || !/\.html$/.test(d.name) || /\.review(\.v\d+)?\.html$/.test(d.name)) continue;
        const head = readFileSync(p, 'utf8').slice(0, 4000);
        if (/<meta\s+name=["'](?:plan-version|pm-kind)["']/i.test(head)) found.push(p);
      }
    };
    walk(root, 0);
    let added = 0;
    for (const page of found) {
      if (find(reg, page)) continue;
      const e = upsert(reg, page);
      added++;
      console.log(`registry: registered "${e.name}"  ${show(page)}  id ${e.id}`);
    }
    if (added) save(reg);
    console.log(`registry: ${found.length} page${found.length === 1 ? '' : 's'} found, ${added} newly registered`);
    break;
  }
  case 'prune': {
    const gone = reg.entries.filter((e) => !existsSync(e.path));
    for (const e of gone) {
      remove(reg, e.id);
      console.log(`registry: dropped "${e.name}" (${e.path} is gone)`);
    }
    if (gone.length) save(reg);
    else console.log('registry: every page still exists');
    break;
  }
  default:
    fail(`unknown command ${cmd}\n${USAGE}`, 2);
}

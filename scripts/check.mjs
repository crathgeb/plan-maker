#!/usr/bin/env node
// Check a plan-maker page after writing it: the structure is sound, nothing of the
// template's example is left behind, and it follows WRITING.md. Node built-ins only.
//
//   node check.mjs <page.html | page-dir> [more pages…] [--json]
//
// Errors break the page or lose the reader's notes; fix every one before handing over.
// Warnings break a writing rule; fix them unless there's a reason not to.
// Exits 1 if any page has an error.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(here, '..', 'templates');
const STYLE = /^<style>$[\s\S]*?^<\/style>$/m;
const KINDS = ['plan', 'guide', 'reference'];

const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => (text(s).match(/\S+/g) || []).length;
const count = (s, re) => (s.match(re) || []).length;

/** The words right after each data-id: enough to tell a block apart from another with the same id. */
function blockTexts(html) {
  const out = new Map();
  for (const m of html.matchAll(/data-id="([^"]+)"[^>]*>/g)) out.set(m[1], text(html.slice(m.index + m[0].length, m.index + m[0].length + 1500)).slice(0, 300));
  return out;
}
/** Blocks of the template's example still on the page: the same id with the same words. */
function leftovers(kind, html) {
  const t = readFileSync(join(TEMPLATES, `${kind}.html`), 'utf8');
  const tpl = blockTexts(t.slice(t.search(/<body[\s>]/i)));
  const mine = blockTexts(html.slice(html.search(/<body[\s>]/i)));
  return [...mine].filter(([id, words]) => words.length > 12 && tpl.get(id) === words).map(([id]) => id);
}

export function check(path) {
  const errors = [];
  const warnings = [];
  const raw = readFileSync(path, 'utf8');
  // Comments, styles and scripts can mention tags; count only the markup.
  const html = raw.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '<script></script>').replace(/<style>[\s\S]*?<\/style>/gi, (m) => (STYLE.test(m) ? m : '<style></style>'));
  const meta = (n) => html.match(new RegExp(`<meta\\s+name=["']${n}["']\\s+content=["']([^"']*)["']`, 'i'))?.[1] ?? null;
  const kind = meta('pm-kind') || 'plan';

  // ---- structure: one of each, and every wrapper closed ----
  for (const [tag, re] of [['<html>', /<html[\s>]/gi], ['<head>', /<head[\s>]/gi], ['<body>', /<body[\s>]/gi], ['<main data-plan>', /<main[\s>]/gi]]) {
    const n = count(html, re);
    if (n !== 1) errors.push(`${n} ${tag} elements: there must be exactly one. ${n > 1 ? 'Part of the template was probably pasted twice.' : ''}`.trim());
  }
  if (count(html, /<nav[^>]*class=["'][^"']*\btoc\b/gi) > 1) errors.push('More than one contents list (nav.toc): the template\'s was left in beside the page\'s.');
  for (const tag of ['div', 'nav', 'main', 'section', 'article', 'header', 'aside', 'ul', 'ol', 'table', 'pre']) {
    const open = count(html, new RegExp(`<${tag}[\\s>]`, 'gi'));
    const close = count(html, new RegExp(`</${tag}>`, 'gi'));
    if (open !== close) errors.push(`<${tag}> opened ${open} times but closed ${close}: the layout will break from there on.`);
  }

  // ---- what the review layer needs ----
  if (!KINDS.includes(kind)) errors.push(`pm-kind is "${kind}": use plan, guide or reference.`);
  if (!meta('pm-kind')) warnings.push('No <meta name="pm-kind">: it reads as a plan.');
  if (!/^\d+$/.test(meta('plan-version') || '')) errors.push('No <meta name="plan-version" content="N">.');
  const ids = [...html.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
  const dup = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dup.length) errors.push(`Repeated data-id: ${dup.join(', ')}. Notes and ticks would land on the wrong block.`);
  const toc = html.match(/<nav[^>]*class=["'][^"']*\btoc\b[\s\S]*?<\/nav>/i)?.[0] || '';
  for (const [, id] of toc.matchAll(/href="#([^"]+)"/g)) {
    if (!html.includes(`id="${id}"`)) errors.push(`The contents link #${id} goes nowhere.`);
  }

  // ---- the template's example left behind ----
  const isTemplate = resolve(dirname(path)) === resolve(TEMPLATES);
  if (KINDS.includes(kind) && !isTemplate) {
    const left = leftovers(kind, html);
    if (left.length) errors.push(`The template's example is still here (ids ${left.slice(0, 5).join(', ')}${left.length > 5 ? '…' : ''}): replace every piece of it.`);
    if (/docs\.example\.com/.test(html)) errors.push('The template\'s example domain (docs.example.com) is still here.');
    const style = html.match(STYLE)?.[0];
    const tpl = readFileSync(join(TEMPLATES, `${kind}.html`), 'utf8').match(STYLE)[0];
    if (!style) errors.push('No template style block (a <style> on its own line): copy it from the template.');
    else if (style !== tpl) warnings.push(`The style block differs from templates/${kind}.html: copy the current one, word for word.`);
  }

  // ---- WRITING.md ----
  const body = html.slice(html.search(/<body[\s>]/i));
  for (const m of body.matchAll(/<section[^>]*class=["'][^"']*\bsec\b[^"']*["'][^>]*>([\s\S]*?)<\/section>/gi)) {
    const sec = m[1];
    const h2 = text(sec.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '?');
    const after = sec.slice((sec.search(/<\/h2>/i) + 5) || 0).trimStart();
    if (!/^<p[^>]*class=["'][^"']*\blede\b/i.test(after)) warnings.push(`Section "${h2}" doesn't open with a one-sentence lede (<p class="lede"> right after its <h2>).`);
  }
  if (kind !== 'reference') {
    const units = [...body.matchAll(/<(?:div|article)[^>]*class=["'](?:[^"']*\s)?(step|phase)(?:\s[^"']*)?["'][^>]*>/gi)];
    const noOwner = units.filter((u) => !/data-who=/.test(u[0]));
    if (noOwner.length && kind === 'guide') warnings.push(`${noOwner.length} step(s) without an owner (data-who="you|claude|both").`);
  } else if (/class=["'][^"']*\b(step|phase)\b/.test(body)) {
    warnings.push('A reference has steps or phases: those belong in a guide or a plan.');
  }
  for (const m of body.matchAll(/<div[^>]*class=["'][^"']*\bentry\b[^>]*>([\s\S]*?)<\/div>/gi)) {
    const head = text(m[1].match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || '');
    const paras = [...m[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((p) => p[1]).join(' ');
    if (words(paras) > 60) warnings.push(`Entry "${head || text(m[1]).slice(0, 40)}" runs ${words(paras)} words: keep the body to two sentences, about 40.`);
  }
  if (kind === 'plan') warnings.push(...planParts(body));
  const hero = body.match(/<header[^>]*class=["'][^"']*\bhero\b[\s\S]*?<\/header>/i)?.[0] || '';
  if (/<[a-z]+\b[^>]*class=["'][^"']*\b(note-box|callout)\b/.test(hero)) warnings.push('A box on the cover: put one caveat in What you need as <p><b>Good to know:</b> …</p>, or give it a section.');
  // Content numbered by hand, imitating steps.
  if (/<h[2-4][^>]*>\s*(?:Step\s+)?\d+[.)]\s/i.test(body)) warnings.push('A heading is numbered by hand: steps are numbered for you, and content is never numbered.');

  return { path, kind, errors, warnings };
}

/** A plan's three parts (WRITING.md): Information holds the content, Steps the phases, Questions the decisions. */
const PARTS = ['information', 'steps', 'questions'];
function planParts(body) {
  const out = [];
  const parts = [...body.matchAll(/<div[^>]*class=["']part["'][^>]*id=["']([^"']+)["'][^>]*>|<div[^>]*id=["']([^"']+)["'][^>]*class=["']part["'][^>]*>/g)]
    .map((m) => ({ id: m[1] || m[2], at: m.index }));
  if (!parts.length) return ["This plan isn't split into its three parts: wrap its sections in Information, Steps and Questions (div.part)."];
  if (parts.map((p) => p.id).join() !== PARTS.join()) out.push(`The plan's parts are ${parts.map((p) => p.id).join(', ')}: there must be information, steps and questions, once each, in that order.`);
  const end = body.search(/<\/main>/i);
  parts.forEach((p, i) => (p.end = i + 1 < parts.length ? parts[i + 1].at : end));
  const partOf = (at) => parts.find((p) => at >= p.at && at < p.end)?.id;
  const where = (re) => [...body.matchAll(re)].map((m) => partOf(m.index));
  for (const m of body.matchAll(/<section[^>]*class=["'][^"']*\bsec\b[^>]*>([\s\S]*?)<\/section>/gi)) {
    const h2 = text(m[1].match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '?');
    const part = partOf(m.index);
    if (!part) out.push(`Section "${h2}" is outside the three parts: put it in Information, Steps or Questions.`);
    else if (part === 'steps' && !/<[a-z]+\b[^>]*class=["'][^"']*\b(phases|steps)\b/.test(m[1])) out.push(`Section "${h2}" is in Steps but has no phases: explanation goes in Information.`);
    else if (part === 'questions' && !/<[a-z]+\b[^>]*class=["'][^"']*\bdecision\b/.test(m[1])) out.push(`Section "${h2}" is in Questions but asks nothing: move it to Information.`);
  }
  if (where(/<[a-z]+\b[^>]*class=["'](?:[^"']*\s)?(phase|step)(?:\s[^"']*)?["']/g).some((p) => p !== 'steps')) out.push('A phase or step sits outside the Steps part.');
  if (where(/<[a-z]+\b[^>]*class=["'][^"']*\bdecision\b/g).some((p) => p !== 'questions')) out.push('A decision sits outside the Questions part: gather them there.');
  if (!/class=["']toc-part["']/.test(body)) out.push('The contents rail has no part headings: list each section under <a class="toc-part" href="#information">Information</a>, Steps and Questions.');
  return out;
}

// ---------- command line ----------
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const pages = args.filter((a) => a !== '--json');
  if (!pages.length) {
    console.error('usage: node check.mjs <page.html | page-dir> [more…] [--json]');
    process.exit(2);
  }
  let failed = false;
  const results = pages.map((p) => {
    let path = resolve(p);
    if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
    if (!existsSync(path)) return { path, errors: [`No such file: ${p}`], warnings: [] };
    return check(path);
  });
  if (asJson) console.log(JSON.stringify(results, null, 2));
  for (const r of results) {
    if (r.errors.length) failed = true;
    if (asJson) continue;
    const ok = !r.errors.length && !r.warnings.length;
    console.log(`${ok ? 'ok   ' : r.errors.length ? 'FAIL ' : 'warn '} ${p(r.path)}`);
    for (const e of r.errors) console.log(`  error: ${e}`);
    for (const w of r.warnings) console.log(`  warn:  ${w}`);
  }
  process.exit(failed ? 1 : 0);
}
function p(path) {
  return path.replace(process.env.HOME || '~', '~');
}

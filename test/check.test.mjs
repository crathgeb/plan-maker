// scripts/check.mjs: a broken page fails, the templates pass, the writing rules warn.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { check } from '../scripts/check.mjs';
import { repo } from './helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'plan-maker-check-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const tpl = (k) => readFileSync(join(repo, 'templates', `${k}.html`), 'utf8');
let n = 0;
const page = (html) => {
  const p = join(dir, String(n++), 'index.html');
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, html);
  return p;
};
/** A guide of the user's own: the template with every example block replaced. */
const own = () => tpl('guide')
  .replace(/<main data-plan>[\s\S]*<\/main>/, `<main data-plan>
<header class="hero" data-id="top"><h1>Rotate the key</h1><p class="lede">Swap the old key for a new one without downtime.</p></header>
<section class="sec" id="swap" data-id="swap">
  <h2>Swap it</h2>
  <p class="lede">Make the new key, then retire the old one.</p>
  <div class="steps">
    <div class="step item" data-id="s-make" data-who="you"><h4>Make the new key</h4><p>In the dashboard, under Keys.</p></div>
  </div>
</section>
</main>`)
  .replace(/<nav class="toc"[\s\S]*?<\/nav>/, '<nav class="toc" aria-label="Contents">\n  <div class="toc-title">Contents</div>\n  <a href="#swap">Swap it</a>\n</nav>');

test('the three templates pass', () => {
  for (const k of ['plan', 'guide', 'reference']) {
    const r = check(join(repo, 'templates', `${k}.html`));
    assert.deepEqual([r.errors, r.warnings], [[], []], k);
  }
});

test('a page of its own passes', () => {
  const r = check(page(own()));
  assert.deepEqual([r.errors, r.warnings], [[], []]);
});

test('part of the template pasted twice fails: two bodies, two contents lists, tags left open', () => {
  // How a real guide broke: the template's opening, up to its first contents link, left above the page's.
  const html = own();
  const at = html.indexOf('<body>');
  const broken = html.slice(0, at) + '<body>\n<div class="desk">\n<nav class="toc" aria-label="Contents">\n  <div class="toc-title">Contents</div>\n  <a href="#records">Add the records</a>\n' + html.slice(at);
  const r = check(page(broken));
  assert.ok(r.errors.some((e) => /2 <body>/.test(e)));
  assert.ok(r.errors.some((e) => /More than one contents list/.test(e)));
  assert.ok(r.errors.some((e) => /<nav> opened 2 times but closed 1/.test(e)));
  assert.ok(r.errors.some((e) => /#records goes nowhere/.test(e)));
});

test("the template's example left in fails; a section that only shares its heading doesn't", () => {
  const r = check(page(tpl('guide')));
  assert.ok(r.errors.some((e) => /example is still here/.test(e)));
  assert.ok(r.errors.some((e) => /docs\.example\.com/.test(e)));
  const shared = own().replace('</main>', `<section class="sec" id="trouble" data-id="trouble">
  <h2>If something goes wrong</h2>
  <p class="lede">What you might see on the way, and what to do about it.</p>
  <div class="table-wrap"><table><tbody><tr class="item" data-id="t-1"><td>401 from the API</td><td>Make the key again.</td></tr></tbody></table></div>
</section>
</main>`);
  assert.deepEqual(check(page(shared)).errors, []);
});

test('repeated ids fail; writing rules warn', () => {
  const html = own()
    .replace('data-id="s-make"', 'data-id="swap"')
    .replace('<p class="lede">Make the new key, then retire the old one.</p>', '')
    .replace('data-id="swap" data-who="you"', 'data-id="swap"')
    .replace('<h4>Make the new key</h4>', '<h4>1. Make the new key</h4>');
  const r = check(page(html));
  assert.ok(r.errors.some((e) => /Repeated data-id: swap/.test(e)));
  assert.ok(r.warnings.some((w) => /"Swap it" doesn't open with a one-sentence lede/.test(w)));
  assert.ok(r.warnings.some((w) => /without an owner/.test(w)));
  assert.ok(r.warnings.some((w) => /numbered by hand/.test(w)));
});

test('the command exits 1 on an error, 0 on warnings only', () => {
  const run = (p) => spawnSync(process.execPath, [join(repo, 'scripts/check.mjs'), p], { encoding: 'utf8' });
  assert.equal(run(page(own().replace('<body>', '<body>\n<body>'))).status, 1);
  const warned = run(page(own().replace('<p class="lede">Make the new key, then retire the old one.</p>', '')));
  assert.equal(warned.status, 0);
  assert.match(warned.stdout, /^warn /m);
});

test("a plan's three parts: none, out of order, or something in the wrong part warns", () => {
  const plan = tpl('plan');
  const warn = (html) => check(page(html)).warnings.join('\n');
  // An older plan, with no parts at all.
  const flat = plan.replace(/<div class="part" id="\w+">\n<div class="part-h">.*<\/div>\n/g, '').replace(/<\/section>\n<\/div>\n/g, '</section>\n');
  assert.match(warn(flat), /isn't split into its parts/);
  // Risks moved into Steps: content among the phases.
  const risks = plan.match(/<section class="sec" id="risks"[\s\S]*?<\/section>\n\n/)[0];
  const misplaced = plan.replace(risks, '').replace('<section class="sec" id="phases"', risks + '<section class="sec" id="phases"');
  assert.match(warn(misplaced), /"What could go wrong" is in Steps but has no phases/);
  // A decision left in Information.
  const decision = plan.match(/<div class="decision" data-decision="cutover"[\s\S]*?\n  <\/div>\n/)[0];
  const stray = plan.replace(decision, '').replace('<section class="sec" id="risks"', `<section class="sec" id="q2" data-id="q2"><h2>Also</h2><p class="lede">One more thing to settle.</p>${decision}</section>\n<section class="sec" id="risks"`);
  assert.match(warn(stray), /decision sits outside the Questions part/);
  // Parts out of order.
  assert.match(warn(plan.replace('id="questions"', 'id="later"')), /use information and steps, then questions and log/);
  // Questions and the log are optional, but an empty Questions part warns.
  const noQ = plan.replace(/<div class="part" id="questions">[\s\S]*?<\/section>\n<\/div>\n\n/, '').replace('  <a class="toc-part" href="#questions">Questions</a>\n', '');
  assert.doesNotMatch(warn(noQ), /parts are|Questions/);
  const emptyQ = plan.replace(/(<div class="part" id="questions">\n<div class="part-h">.*<\/div>\n)[\s\S]*?<\/section>\n/, '$1');
  assert.match(warn(emptyQ), /Questions part has nothing open/);
});

test('markup written as text (escaped code) is not counted as a phase or decision', () => {
  const plan = tpl('plan').replace('<p class="lede">How the docs work today', '<p>Phases are <code>&lt;article class="phase"&gt;</code>; decisions are <code>class="decision"</code>.</p>\n  <p class="lede">How the docs work today');
  const w = check(page(plan)).warnings.join('\n');
  assert.doesNotMatch(w, /outside the (Steps|Questions) part/);
});

test('a box on the cover warns', () => {
  const html = own().replace('<p class="lede">Swap the old key for a new one without downtime.</p>', '<p class="lede">Swap the old key for a new one without downtime.</p><p class="note-box">Nothing else changes.</p>');
  assert.match(check(page(html)).warnings.join('\n'), /A box on the cover/);
});

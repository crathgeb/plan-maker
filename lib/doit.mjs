// "Do it for me" on a guide's section: hand the section to a new Claude Code session, in a Terminal
// window on this Mac, with Claude in Chrome turned on, so Claude does the steps in the reader's own
// browser while they watch (README "Do it for me"). Node built-ins only.
//
// The review server writes the task prompt, the rules and a `.command` script into
// <home>/sessions/, then runs `open <script>.command`: Terminal opens a visible window in the
// reader's login session (no AppleScript permission needed). The script cds into the page's project
// and starts
//
//   claude --chrome --remote-control "<guide>: <section>" -n <session> \
//     --allowedTools "Bash(node …/step.mjs <page> *)" --append-system-prompt "$(cat rules)" "$(cat prompt)"
//
// Permissions stay normal. The session ticks steps off with scripts/step.mjs, which the open page
// shows at once.
//
// The button only shows where it can work: macOS, a Claude Code binary, and Claude in Chrome
// installed (Claude Code's own record of it in ~/.claude.json, else Chrome's native messaging host
// for it). Asked from this machine only: the window opens here.
//
// Env: PLAN_MAKER_DOIT (auto | on | off; default auto), PLAN_MAKER_CLAUDE_BIN (default: the first of
// ~/.local/bin/claude, ~/.claude/local/claude, claude on PATH), PLAN_MAKER_CLAUDE_FLAGS (default
// --chrome; before --remote-control), PLAN_MAKER_OPEN_BIN (/usr/bin/open; tests use a stand-in),
// PLAN_MAKER_CLAUDE_JSON (~/.claude.json).

import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { home, readSteps } from './registry.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const STEP_CLI = join(ROOT, 'scripts', 'step.mjs');
const PROMPTS = join(ROOT, 'prompts');

const fail = (message, status) => Object.assign(new Error(message), { status });

/** A shell word: 'single-quoted', with any ' closed, escaped and reopened. */
export const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** The Claude Code binary to start, or null. */
export function claudeBin(env = process.env) {
  if (env.PLAN_MAKER_CLAUDE_BIN) return env.PLAN_MAKER_CLAUDE_BIN;
  const tries = [join(homedir(), '.local', 'bin', 'claude'), join(homedir(), '.claude', 'local', 'claude')];
  for (const d of (env.PATH || '').split(delimiter).filter(Boolean)) tries.push(join(d, 'claude'));
  return tries.find((p) => existsSync(p)) || null;
}

// Chromium browsers' native messaging host folders on macOS: Claude in Chrome's host lives in one.
const HOST = 'com.anthropic.claude_code_browser_extension.json';
const BROWSERS = ['Google/Chrome', 'Google/Chrome Beta', 'Google/Chrome Canary', 'Chromium', 'BraveSoftware/Brave-Browser', 'Microsoft Edge', 'Arc/User Data'];

/** Is Claude in Chrome installed? Claude Code's cached answer, else its native host being set up. */
export function chromeInstalled(env = process.env) {
  try {
    const cfg = JSON.parse(readFileSync(env.PLAN_MAKER_CLAUDE_JSON || join(homedir(), '.claude.json'), 'utf8'));
    if (typeof cfg.cachedChromeExtensionInstalled === 'boolean') return cfg.cachedChromeExtensionInstalled;
  } catch {}
  const support = join(homedir(), 'Library', 'Application Support');
  return BROWSERS.some((b) => existsSync(join(support, b, 'NativeMessagingHosts', HOST)));
}

let cached = null;
/** { available, why }: whether Do it for me can work on this machine. Checked at most once a minute. */
export function doItAvailable(env = process.env) {
  const mode = (env.PLAN_MAKER_DOIT || 'auto').toLowerCase();
  if (mode === 'off') return { available: false, why: 'turned off (PLAN_MAKER_DOIT=off)' };
  if (mode === 'on') return { available: true, why: '' };
  if (cached && Date.now() - cached.at < 60_000) return cached.v;
  let v;
  if (process.platform !== 'darwin') v = { available: false, why: 'it opens a Terminal window, on macOS only' };
  else if (!claudeBin(env)) v = { available: false, why: 'Claude Code isn’t installed here' };
  else if (!chromeInstalled(env)) v = { available: false, why: 'Claude in Chrome isn’t installed' };
  else v = { available: true, why: '' };
  cached = { at: Date.now(), v };
  return v;
}

const text = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

/** A section of the page and its steps: { id, title, steps: [{ id, who, status, title }] }, or null. */
export function readSection(html, id) {
  const opens = [...html.matchAll(/<section\b[^>]*>/gi)];
  const i = opens.findIndex((m) => (m[0].match(/\bdata-id=["']([^"']*)["']/i)?.[1] ?? null) === id);
  if (i < 0) return null;
  const start = opens[i].index;
  const body = html.slice(start, i + 1 < opens.length ? opens[i + 1].index : html.length);
  const title = text(body.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '') || id;
  return { id, title, steps: readSteps(body) };
}

/** Which steps the reader (or a session) has ticked: notes.json's steps, plus Claude's own done ones. */
export function doneSteps(section, notes) {
  const ticked = notes?.steps || {};
  return new Set(section.steps.filter((s) => ticked[s.id]?.done || (s.who === 'claude' && s.status === 'done')).map((s) => s.id));
}

const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const WHO = { you: 'the reader’s', claude: 'Claude’s', both: 'Claude prepares, the reader confirms' };

/** The task prompt and the system-prompt rules for one section. */
export function buildPrompt({ page, url, name, project, section, done }) {
  const node = process.execPath;
  const step = `${node.includes(' ') ? JSON.stringify(node) : node} ${STEP_CLI} ${sh(page)}`;
  const list = section.steps
    .map((s, i) => `${i + 1}. ${s.title || s.id} (id \`${s.id}\`, ${WHO[s.who] || WHO.you} step)${done.has(s.id) ? ': already done, skip it' : ''}`)
    .join('\n');
  const vars = { name, page, url, project, section: section.title, section_id: section.id, steps: list, step };
  return {
    prompt: fill(readFileSync(join(PROMPTS, 'doit.md'), 'utf8'), vars),
    rules: readFileSync(join(PROMPTS, 'doit-rules.md'), 'utf8'),
  };
}

/** The session's names: `-n <page folder>-<section>` and Remote Control's "<guide>: <section>". */
export function sessionNames(page, name, section) {
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/[,;:\s]+$/, '') + '…' : s);
  const slug = basename(dirname(page)).replace(/[^\w.-]+/g, '-');
  return { session: `${slug}-${section.id}`.slice(0, 80), remote: `${clip(name, 32)}: ${clip(section.title, 40)}` };
}

/** The `.command` script: cd into the project, then Claude with Chrome and Remote Control, in Terminal. */
export function buildScript({ page, name, project, section, files, env = process.env }) {
  const claude = claudeBin(env) || 'claude';
  const flags = (env.PLAN_MAKER_CLAUDE_FLAGS ?? '--chrome').split(/\s+/).filter(Boolean);
  const { session, remote } = sessionNames(page, name, section);
  // Ticks are pre-allowed so the session doesn't stop to ask for each one.
  const allow = `Bash(${process.execPath} ${STEP_CLI} ${page} *)`;
  const argv = [claude, ...flags, '--allowedTools', allow, '--remote-control', remote, '-n', session];
  const command = `${argv.map(sh).join(' ')} --append-system-prompt "$(cat ${sh(files.rules)})" "$(cat ${sh(files.prompt)})"`;
  const exports = ['PLAN_MAKER_HOME'].filter((k) => env[k]).map((k) => `export ${k}=${sh(env[k])}`);
  const text = `#!/bin/zsh -l
# plan-maker, "Do it for me": ${section.title.replace(/\n/g, ' ')} in ${name.replace(/\n/g, ' ')}. Terminal runs this; it is safe to delete.
export PATH=${sh(dirname(process.execPath))}:"$PATH"
${exports.join('\n')}
cd ${sh(project)} || { echo "The project isn't at ${project.replace(/"/g, '')}."; exit 1; }
printf '\\n  Claude is doing "%s" for you.\\n  Remote Control: %s\\n\\n' ${sh(section.title)} ${sh(remote)}
${command}
`;
  return { text, command, session, remote };
}

function openFile(bin, file) {
  return new Promise((done) => {
    execFile(bin, [file], { timeout: 20000 }, (err, _stdout, stderr) => done({ ok: !err, stderr: String(stderr || err?.message || '').trim() }));
  });
}

const recent = new Map(); // "<page>#<section>" → when it was started

/**
 * Hand a guide section to a new Claude session: write the files, open Terminal.
 * Returns { session, remote, files, command }. Throws with .status on a refusal.
 */
export async function doSection({ page, url, name, project, kind, html, notes, section: id, env = process.env }) {
  const avail = doItAvailable(env);
  if (!avail.available) throw fail(`Do it for me isn’t available: ${avail.why}`, 409);
  if (kind !== 'guide') throw fail('Do it for me is for a guide’s sections', 400);
  const section = readSection(html, String(id || ''));
  if (!section) throw fail(`no section ${id} on this page`, 404);
  if (!section.steps.length) throw fail(`“${section.title}” has no steps to do`, 400);
  const done = doneSteps(section, notes);
  if (section.steps.every((s) => done.has(s.id))) throw fail(`every step of “${section.title}” is already done`, 409);
  const key = `${page}#${section.id}`;
  if (Date.now() - (recent.get(key) || 0) < 60_000) throw fail(`Claude started on “${section.title}” less than a minute ago: it’s in the Terminal window`, 409);

  const dir = join(home(), 'sessions');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  const base = join(dir, `${sessionNames(page, name, section).session}-${stamp}`);
  const files = { prompt: `${base}.prompt.md`, rules: `${base}.rules.md`, script: `${base}.command` };
  const { prompt, rules } = buildPrompt({ page, url, name, project, section, done });
  writeFileSync(files.prompt, prompt);
  writeFileSync(files.rules, rules);
  const script = buildScript({ page, name, project, section, files, env });
  writeFileSync(files.script, script.text);
  chmodSync(files.script, 0o755);

  const opened = await openFile(env.PLAN_MAKER_OPEN_BIN || '/usr/bin/open', files.script);
  if (!opened.ok) throw fail(`Terminal didn’t open: ${opened.stderr.split('\n')[0] || 'open failed'}`, 502);
  recent.set(key, Date.now());
  return { session: script.session, remote: script.remote, files, command: script.command, section: { id: section.id, title: section.title } };
}

// ---------- ticking steps off (scripts/step.mjs, and POST /api/steps/<id>) ----------

/** The section a step is in, by the nearest <section data-id> before it. */
function sectionOf(html, stepId) {
  const at = html.search(new RegExp(`\\bdata-id=["']${stepId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`));
  if (at < 0) return null;
  const opens = [...html.slice(0, at).matchAll(/<section\b[^>]*\bdata-id=["']([^"']*)["'][^>]*>/gi)];
  return opens.length ? readSection(html, opens.at(-1)[1]) : null;
}

/**
 * Tick a step off in notes.json (or untick it): what the reader's Mark done writes, marked by Claude.
 * Returns { steps, step }. The review server sends the new steps to the open tabs.
 */
export function tickStep(page, id, { done = true, note = '' } = {}) {
  const html = readFileSync(page, 'utf8');
  const step = readSteps(html).find((s) => s.id === id);
  if (!step) throw fail(`no step ${id} on this page`, 404);
  const notesPath = join(dirname(page), 'notes.json');
  let notes = null;
  try { notes = JSON.parse(readFileSync(notesPath, 'utf8')); } catch {}
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) {
    notes = { version: 1, plan: basename(dirname(page)), planVersion: html.match(/<meta\s+name=["']plan-version["']\s+content=["']([^"']*)["']/i)?.[1] || null, general: '', items: {}, highlights: [], decisions: {}, drawings: [], steps: {} };
  }
  notes.steps = notes.steps && typeof notes.steps === 'object' ? notes.steps : {};
  if (!done) delete notes.steps[id];
  else {
    const sec = sectionOf(html, id);
    const own = step.title || id;
    notes.steps[id] = { done: true, doneAt: new Date().toISOString(), where: sec && sec.title !== own ? `${sec.title} › ${own}` : own, by: 'claude', ...(String(note).trim() ? { note: String(note).trim().slice(0, 2000) } : {}) };
  }
  notes.updatedAt = new Date().toISOString();
  const tmp = `${notesPath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(notes, null, 2) + '\n');
  renameSync(tmp, notesPath);
  return { steps: notes.steps, step };
}

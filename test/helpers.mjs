// Shared test helpers: start the review server, drive a browser, read notes.json.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** Copy a plan into a fresh temp folder so notes.json lands there. */
export function planCopy(src) {
  const dir = mkdtempSync(join(tmpdir(), 'plan-maker-'));
  const plan = join(dir, 'index.html');
  copyFileSync(src, plan);
  return { dir, plan, notes: join(dir, 'notes.json') };
}

let nextPort = 4700 + Math.floor(Math.random() * 500);

/** Start review.mjs on a plan; resolves once it prints its URL. */
export function startServer(plan, extra = []) {
  const proc = spawn(process.execPath, [join(repo, 'scripts/review.mjs'), plan, '--no-open', '--port', String(nextPort), ...extra], {
    cwd: dirname(plan),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  nextPort += 25;
  let out = '';
  return new Promise((ok, bad) => {
    const timer = setTimeout(() => bad(new Error('server did not start:\n' + out)), 5000);
    const onData = (d) => {
      out += d;
      const m = out.match(/open\s+→\s+(http:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        ok({ url: m[1], proc, output: () => out, stop: () => proc.kill() });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (!out.match(/open\s+→/)) bad(new Error(`server exited ${code}:\n${out}`));
    });
  });
}

export async function launch() {
  if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}; set CHROME_PATH`);
  return chromium.launch({ executablePath: CHROME });
}

/** A page that records console errors and uncaught exceptions into `errors`. */
export async function newPage(browser, errors, viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  page.on('response', (r) => r.status() >= 400 && errors.push(`http ${r.status()}: ${r.url()}`));
  return page;
}

export async function open(page, url) {
  await page.goto(url);
  await page.waitForSelector('html[data-pm-ready]');
}

/** Select characters [start, end) of a block's visible text, then fire mouseup as a user would. */
export async function selectText(page, blockId, start, end) {
  return page.evaluate(
    ([id, s, e]) => {
      const block = document.querySelector(`[data-id="${id}"]`);
      const nodes = [];
      const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.parentElement.closest('.pm-ui') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      while (w.nextNode()) nodes.push(w.currentNode);
      const at = (off) => {
        let pos = 0;
        for (const n of nodes) {
          if (off <= pos + n.data.length) return [n, off - pos];
          pos += n.data.length;
        }
        throw new Error('offset out of range');
      };
      const r = document.createRange();
      r.setStart(...at(s));
      r.setEnd(...at(e));
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      block.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return sel.toString();
    },
    [blockId, start, end],
  );
}

export function readNotes(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

/** Poll notes.json until `check(notes)` is truthy. */
export async function waitForNotes(path, check, timeout = 4000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    try {
      last = readNotes(path);
      if (last && check(last)) return last;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('notes.json never matched; last saw:\n' + JSON.stringify(last, null, 2));
}

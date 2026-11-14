// Start (or reuse) the review server for a page and resolve with its URL.
// Used by the hub (Open) and by a review server following a link to another
// page (a plan's guide, a guide's plan). Node built-ins only.

import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { home, idFor, projectOf } from './registry.mjs';

const REVIEW = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'review.mjs');

/**
 * `extra`: more review.mjs arguments (e.g. ['--host', addr] to match the caller's network mode).
 * Resolves with { url, net }: the loopback URL, and any keyed network URLs the server printed.
 */
export function startReview(pagePath, extra = []) {
  const logs = join(home(), 'logs');
  mkdirSync(logs, { recursive: true });
  const logFile = join(logs, `${idFor(pagePath)}.log`);
  // Output goes to a file, not a pipe, so the review server keeps running after its starter exits.
  const fd = openSync(logFile, 'w');
  const child = spawn(process.execPath, [REVIEW, pagePath, '--no-open', ...extra], {
    cwd: projectOf(pagePath),
    stdio: ['ignore', fd, fd],
    detached: true,
  });
  closeSync(fd);
  child.unref();
  return new Promise((ok, bad) => {
    const t0 = Date.now();
    const tick = () => {
      const out = readFileSync(logFile, 'utf8');
      const url = out.match(/open\s+→\s+(http:\/\/\S+)/)?.[1];
      // A network-mode server prints its keyed URLs on the lines after "open →".
      // A second start for the same page reprints them and exits, so wait for that.
      if (url && (!extra.includes('--host') || /Ctrl-C/.test(out) || child.exitCode === 0)) {
        return ok({ url, net: [...out.matchAll(/(http:\/\/\S+\?key=\S+)/g)].map((m) => m[1]) });
      }
      if (child.exitCode != null && child.exitCode !== 0) return bad(new Error(`the review server stopped:\n${out}`));
      if (Date.now() - t0 > 6000) return bad(new Error(`the review server didn't start:\n${out}`));
      setTimeout(tick, 80);
    };
    tick();
  });
}

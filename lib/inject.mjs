// Puts the annotation layer (annotator.css + annotator.js) into a plan's HTML,
// just before </body>. Used by the review server on every request and by the
// bundle command once. Node built-ins only.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MARKER = 'data-plan-maker';

export function readLayer() {
  return {
    css: readFileSync(join(here, 'annotator.css'), 'utf8'),
    js: readFileSync(join(here, 'annotator.js'), 'utf8'),
  };
}

// JSON that is safe inside a <script> element.
function scriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function hasLayer(html) {
  return html.includes(`<script ${MARKER}`);
}

/**
 * @param {string} html   the plan
 * @param {object} config becomes window.PLAN_MAKER: { mode, plan, notesPath, notes? }
 */
export function inject(html, config, layer = readLayer()) {
  if (hasLayer(html)) return html;
  const block =
    `\n<!-- plan-maker annotation layer: https://github.com/crathgeb/plan-maker -->\n` +
    `<style ${MARKER}>\n${layer.css}</style>\n` +
    `<script ${MARKER}>window.PLAN_MAKER = ${scriptJson(config)};</script>\n` +
    `<script ${MARKER}>\n${layer.js}</script>\n`;
  const i = html.toLowerCase().lastIndexOf('</body>');
  return i === -1 ? html + block : html.slice(0, i) + block + html.slice(i);
}

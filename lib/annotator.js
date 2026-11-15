/*
 * plan-maker annotation layer.
 *
 * Turns any HTML plan into a review surface: select text to comment or ask,
 * comment on items, steps and sections, answer decisions, write general notes, draw arrows, boxes, circles, points and
 * sticky notes anywhere. Builds all of its own UI; the plan only needs plain
 * HTML that follows the conventions in the README.
 *
 * Three kinds of page (<meta name="pm-kind">), all reviewed like a shared doc:
 *   plan       phases (.phase[data-who]), each owned by the reader or Claude, and
 *              linked to a guide (data-guide) when the reader's part needs steps
 *   guide      steps (.step[data-who]) to follow, mostly the reader's
 *   reference  sections to look things up in: no progress
 * On every kind: select text to Comment, Ask Claude or ask for More detail, or
 * use the buttons on any block (.item, .step, .phase, section). The reader's
 * units get Mark done; Claude's show the status Claude set (data-status=
 * "todo|doing|done"). A plan's phase offers Make a guide. Every <pre> gets Copy.
 *
 * Injected by scripts/review.mjs (saves to notes.json through the server) or
 * inlined by scripts/bundle.mjs (saves in the browser, with a download).
 * Configuration comes from window.PLAN_MAKER:
 *   mode         'server' | 'standalone' | 'snapshot'
 *   plan         the plan's path, for notes.json and the browser-storage key
 *   notesPath    where the server saves notes, for display
 *   version      the version this page shows; current: the live version
 *   readOnly     an earlier version: show its notes, change nothing
 *   legacy       an earlier version with its own review script: only add the banner and switcher
 *   notes        notes to show (read-only), or to start from (standalone)
 *   versions     [{ version, current, href, date, summary }] (else fetched from /api/versions)
 *   currentHref  link to the live version (default "/")
 */
(() => {
  'use strict';
  if (window.__planMaker) return;
  window.__planMaker = true;

  const CFG = Object.assign(
    { mode: 'auto', plan: location.pathname, notesPath: 'notes.json', notes: null },
    window.PLAN_MAKER || {},
  );
  const SCHEMA = 1;
  const HEADINGS = 'h1, h2, h3, h4, h5, h6';
  // Blocks that get an id when the plan has no data-id at all.
  const AUTO_BLOCKS = 'p, li, pre, blockquote, table, tbody > tr, dt, dd, figure';
  // Of those, the ones that get Keep / Change / Cut.
  const AUTO_ITEMS = 'li, tbody > tr, pre, blockquote, p:not(li p, blockquote p, td p, th p, dd p)';
  const SKIP = '.pm-ui, [data-no-annotate], script, style, template, noscript, textarea';
  const SHAPES = { arrow: 'Arrow', box: 'Box', circle: 'Circle', point: 'Point', pen: 'Pen', note: 'Sticky note' };
  // The floating toolbar's tools, in order, with their keys. Select (V) puts the pen down.
  const TOOLS = [
    ['select', 'Select', 'V', '<path d="M3.5 2.5v10l2.8-2.6 1.9 4.1 1.6-.7-1.9-4.1h3.8z" class="pm-fill"/>'],
    ['point', 'Point', 'P', '<circle cx="8" cy="8" r="3.2" class="pm-fill"/>'],
    ['box', 'Box', 'B', '<rect x="2.5" y="3.5" width="11" height="9" rx="2"/>'],
    ['circle', 'Circle', 'C', '<ellipse cx="8" cy="8" rx="5.8" ry="4.6"/>'],
    ['arrow', 'Arrow', 'A', '<path d="M3 13 13 3M7 3h6v6"/>'],
    ['pen', 'Pen', 'D', '<path d="M2.5 12.5c2-3 3.2-.2 5-2.5s1.3-5 3.5-6.5 3 .5 2.5 1.5"/>'],
    ['note', 'Sticky note', 'N', '<path d="M3 3h10v6.5L9.5 13H3z"/><path d="M13 9.5H9.5V13"/>'],
  ];
  const ICON = {
    grip: '<circle cx="6" cy="4" r=".7" class="pm-fill"/><circle cx="10" cy="4" r=".7" class="pm-fill"/><circle cx="6" cy="8" r=".7" class="pm-fill"/><circle cx="10" cy="8" r=".7" class="pm-fill"/><circle cx="6" cy="12" r=".7" class="pm-fill"/><circle cx="10" cy="12" r=".7" class="pm-fill"/>',
    comments: '<path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z"/>',
    send: '<path d="M2.5 8 13.5 3l-4 10.5-2-4.5z"/><path d="M7.5 9 13.5 3"/>',
    focus: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>',
    unfocus: '<path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5"/>',
  };
  const svg16 = (body) => `<svg viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
  // A page's status in the registry (lib/kinds.mjs), shown and changed from the top bar.
  const STATUS_LABELS = { draft: 'Draft', reviewing: 'Reviewing', approved: 'Approved', 'not-started': 'Not started', 'in-progress': 'In progress', blocked: 'Blocked', current: 'Current', done: 'Done', archived: 'Archived' };
  const KIND_STATUSES = {
    plan: ['draft', 'reviewing', 'approved', 'in-progress', 'blocked', 'done', 'archived'],
    guide: ['draft', 'reviewing', 'not-started', 'in-progress', 'blocked', 'done', 'archived'],
    reference: ['draft', 'reviewing', 'current', 'archived'],
  };
  // What a note asks of Claude. A comment and a question need words; more detail and a guide don't.
  const KINDS_OF_NOTE = { note: 'Comment', question: 'Question', detail: 'More detail', guide: 'Make a guide' };
  // The units of progress: a guide's steps, a plan's phases (a .phase without an owner is just a block).
  const UNIT = '.step[data-id], .phase[data-id][data-who]';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const make = (tag, attrs = {}, html = '') => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (html) e.innerHTML = html;
    return e;
  };
  const meta = (n) => document.querySelector(`meta[name="${n}"]`)?.getAttribute('content') || null;
  const clip = (s, n) => {
    s = (s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };
  const slug = (s) =>
    (s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/, '') || 'block';
  const now = () => new Date().toISOString();

  const root = $('[data-plan]') || $('main') || document.body;
  const KIND = ['plan', 'guide', 'reference'].includes((meta('pm-kind') || '').toLowerCase()) ? meta('pm-kind').toLowerCase() : 'plan';
  const NOUN = { plan: 'plan', guide: 'guide', reference: 'reference' }[KIND];
  document.documentElement.dataset.pmKind = KIND;
  const byId = (id) => root.querySelector(`[data-id="${CSS.escape(id)}"]`);
  const READ_ONLY = !!CFG.readOnly;
  const PLAN_VERSION = meta('plan-version') || (CFG.version != null ? String(CFG.version) : null);
  const SHOWN = CFG.version != null ? Number(CFG.version) : Number(PLAN_VERSION) || null; // version on screen
  const LS_KEY = 'plan-maker:' + (meta('plan-id') || CFG.plan) + (PLAN_VERSION ? ':v' + PLAN_VERSION : '');

  let state = {
    version: SCHEMA,
    plan: CFG.plan,
    planVersion: PLAN_VERSION,
    title: document.title,
    updatedAt: null,
    general: '',
    items: {},
    highlights: [],
    decisions: {},
    drawings: [],
    steps: {},
  };
  let serverOk = false;
  let locked = false; // Claude has the notes: nothing on the page changes until it's done
  let sendCount = 0;
  let saveTimer = null;
  let autoMode = false;
  const ctx = new WeakMap(); // element -> { section, heading } (nearest headings above it)
  const ctls = new Map(); // item id -> its bar of controls
  let links = { phases: {}, parent: null }; // where the page's links lead (/api/links)
  const secBtns = new Map(); // section id -> its note button

  // ---------- text model ----------
  // Highlight offsets count only the plan's own text: everything this layer
  // adds is inside .pm-ui and skipped, so offsets survive re-decoration.
  function textNodes(node) {
    const out = [];
    const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    while (w.nextNode()) out.push(w.currentNode);
    return out;
  }
  const visibleText = (node) => textNodes(node).map((t) => t.data).join('');

  function offsetIn(block, container, offset) {
    const r = document.createRange();
    r.setStart(block, 0);
    try {
      r.setEnd(container, offset);
    } catch {
      return 0;
    }
    let total = 0;
    for (const t of textNodes(block)) {
      if (t === container) return total + offset;
      if (!r.intersectsNode(t)) continue;
      total += t.data.length;
    }
    return total;
  }

  function wrapOffsets(block, start, end, hid) {
    let pos = 0;
    const marks = [];
    for (const t of textNodes(block)) {
      const len = t.data.length;
      const s = pos;
      const e = pos + len;
      pos = e;
      if (e <= start || s >= end) continue;
      const a = Math.max(start - s, 0);
      const b = Math.min(end - s, len);
      let node = t;
      if (a > 0) node = node.splitText(a);
      if (b - a < node.data.length) node.splitText(b - a);
      if (!node.data.trim()) continue;
      const m = make('mark', { class: 'pm-hl', 'data-h': hid });
      node.parentNode.insertBefore(m, node);
      m.appendChild(node);
      marks.push(m);
    }
    return marks;
  }

  // Where a highlight lives now: its offsets if the text there still matches,
  // else the quote anywhere in its block, else the smallest block that holds it.
  function findQuote(h) {
    const block = byId(h.blockId);
    if (block) {
      const full = visibleText(block);
      if (full.slice(h.start, h.end) === h.quote) return [block, h.start, h.end];
      const i = full.indexOf(h.quote);
      if (i !== -1) return [block, i, i + h.quote.length];
    }
    let best = null;
    for (const b of $$('[data-id]', root)) {
      const full = visibleText(b);
      const i = full.indexOf(h.quote);
      if (i !== -1 && (!best || full.length < best[3])) best = [b, i, i + h.quote.length, full.length];
    }
    if (!best) return null;
    h.blockId = best[0].dataset.id;
    return best;
  }

  function paintHighlight(h) {
    const at = findQuote(h);
    if (!at) return false;
    const [block, start, end] = at;
    h.start = start;
    h.end = end;
    const marks = wrapOffsets(block, start, end, h.id);
    marks.forEach((m) => {
      m.dataset.n = h.n;
      m.addEventListener('click', () => focusNote('h:' + h.id));
    });
    if (marks.length) marks[marks.length - 1].dataset.last = '1';
    return marks.length > 0;
  }

  function unpaintHighlight(hid) {
    $$(`mark.pm-hl[data-h="${CSS.escape(hid)}"]`).forEach((m) => {
      const p = m.parentNode;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      p.normalize();
    });
  }

  // ---------- ids and labels ----------
  // Plans written to the conventions carry data-id on every annotatable block.
  // A plan with none at all (say, converted from markdown) gets ids from its
  // headings: "risks" for the heading, "risks-1", "risks-2"… for the blocks
  // under it, "risks--2" for a second heading with the same text. Same
  // content, same ids.
  function assignIds() {
    autoMode = !root.querySelector('[data-id]');
    const used = new Set($$('[data-id]', root).map((e) => e.dataset.id));
    // Repeats get "--2", "--3": slugs never contain "--", so these can't
    // collide with block ids like "goals-2".
    const uniq = (base) => {
      let id = base;
      for (let i = 2; used.has(id); i++) id = `${base}--${i}`;
      used.add(id);
      return id;
    };
    const count = {};
    let key = 'top';
    let section = '';
    let heading = '';
    for (const node of root.querySelectorAll('*')) {
      if (node.closest(SKIP)) continue;
      if (autoMode && node.closest('nav')) continue;
      if (node.matches(HEADINGS)) {
        const text = clip(visibleText(node), 120);
        if (autoMode && !node.dataset.id) node.dataset.id = uniq(slug(text));
        key = node.dataset.id || slug(text);
        heading = text;
        if (/^H[12]$/.test(node.tagName)) section = text;
      }
      ctx.set(node, { section, heading });
      if (node.dataset.id) continue;
      let id = null;
      if (node.matches('section')) {
        id = uniq('sec-' + slug(visibleText(node.querySelector(HEADINGS) || node).slice(0, 80) || key));
      } else if (node.matches('.decision')) {
        id = uniq('d-' + slug(node.dataset.decision || key));
      } else if (node.matches('.item') || (autoMode && node.matches(AUTO_BLOCKS))) {
        count[key] = (count[key] || 0) + 1;
        id = uniq(`${key}-${count[key]}`);
      }
      if (id) {
        node.dataset.id = id;
        node.dataset.pmAuto = '';
      }
    }
    if (autoMode) {
      $$(AUTO_ITEMS, root).forEach((n) => {
        if (n.dataset.id && !n.closest('nav, [data-no-annotate]')) n.classList.add('item');
      });
    }
  }

  function sectionName(node) {
    const sec = node.closest('section');
    const h = sec && sec.querySelector(HEADINGS);
    return h ? clip(visibleText(h), 60) : ctx.get(node)?.section || '';
  }

  function labelFor(node) {
    if (!node) return 'Plan';
    if (node.matches('section')) return 'Section: ' + clip(visibleText(node.querySelector(HEADINGS) || node), 70);
    let own;
    if (node.matches(HEADINGS)) own = visibleText(node);
    else if (node.tagName === 'TR') own = node.cells[0] ? visibleText(node.cells[0]) : visibleText(node);
    else if (node.matches('table, pre, figure')) {
      const kind = { TABLE: 'table', PRE: 'code', FIGURE: 'figure' }[node.tagName];
      own = `${ctx.get(node)?.heading || ''} (${kind})`;
    } else own = visibleText(node.querySelector('h1, h2, h3, h4, h5, h6, b, strong') || node);
    own = clip(own, 70);
    const sec = sectionName(node);
    return sec && sec !== own ? `${sec} › ${own}` : own;
  }

  const excerpt = (node) => (node ? clip(visibleText(node), 140) : '');

  // ---------- persistence ----------
  async function load() {
    let loaded = null;
    if (READ_ONLY) {
      if (CFG.notes && typeof CFG.notes === 'object') Object.assign(state, CFG.notes);
      setStatus(`Read-only · v${SHOWN}`);
      return;
    }
    if (CFG.mode !== 'standalone') {
      try {
        const r = await fetch('/api/notes', { cache: 'no-store' });
        if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
          serverOk = true;
          loaded = await r.json();
        }
      } catch {}
    }
    if (!serverOk) {
      try {
        loaded = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      } catch {}
      if (!loaded && CFG.notes) loaded = CFG.notes;
    }
    if (loaded && typeof loaded === 'object') {
      state = Object.assign(state, loaded, {
        plan: CFG.plan,
        planVersion: state.planVersion,
        title: state.title,
      });
      state.items = state.items || {};
      state.highlights = state.highlights || [];
      state.decisions = state.decisions || {};
      state.drawings = state.drawings || [];
      state.steps = state.steps || {};
      delete state.kind; // plan-maker 0.2 guides: one kind of page now
    }
    setStatus(serverOk ? 'Saving to ' + CFG.notesPath.split('/').pop() : 'Saving in this browser');
  }

  function save() {
    if (READ_ONLY || locked) return;
    state.updatedAt = now();
    state.autoIds = autoMode;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch {}
    renderSummary();
    clearTimeout(saveTimer);
    setStatus('Saving…');
    saveTimer = setTimeout(async () => {
      if (!serverOk) {
        setStatus('Saved in this browser');
        return;
      }
      try {
        const r = await fetch('/api/notes', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(state, null, 2) + '\n',
        });
        if (r.status === 409) setStatus('Not saved: ' + (await r.text()));
        else setStatus(r.ok ? 'Saved ✓ ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Save failed');
      } catch {
        setStatus('Save failed: is the review server running?');
      }
    }, 350);
  }

  // ---------- UI ----------
  let ui;
  function buildUi() {
    const panel = make(
      'aside',
      { id: 'pm-panel', class: 'pm-ui', 'aria-label': 'Comments' },
      `<div class="pm-head"><strong>Comments</strong><button type="button" class="pm-x" aria-label="Close comments">×</button></div>
       <p class="pm-help">Select text, then <b>Comment</b>, <b>Ask Claude</b> or <b>More detail</b>, or use the buttons on any block.${KIND === 'reference' ? '' : ' Tick off your part with <b>Mark done</b>.'} Everything saves as you go.</p>
       <label class="pm-lbl" for="pm-general">On the whole ${NOUN}</label>
       <textarea id="pm-general" placeholder="Anything that isn't about one spot: direction, priorities, what's missing…"></textarea>
       <div id="pm-summary"></div>
       <div id="pm-list"></div>`,
    );
    const bar = make(
      'div',
      { id: 'pm-bar', class: 'pm-ui', role: 'toolbar', 'aria-label': 'Plan review' },
      `<span class="pm-ver" hidden><button type="button" id="pm-ver" aria-haspopup="menu" aria-expanded="false"></button><div id="pm-vmenu" role="menu" hidden></div></span>
       <span id="pm-status" aria-live="polite">Loading…</span>
       <button type="button" id="pm-reload" hidden>Page updated · Reload</button>
       <span id="pm-claude" class="pm-pill" data-s="offline" hidden><span class="pm-pill-dot" aria-hidden="true"></span><span class="pm-pill-t">Claude offline</span></span>
       <button type="button" id="pm-toggle">Comments <span id="pm-count">0</span></button>
       <button type="button" id="pm-send" class="pm-primary" hidden>Send<span class="pm-wide">&nbsp;to Claude</span><span class="pm-send-n" id="pm-send-n" hidden></span></button>
       <button type="button" id="pm-done" class="pm-primary">Done<span class="pm-wide">&nbsp;for now</span></button>`,
    );
    const pop = make('div', { id: 'pm-pop', class: 'pm-ui', role: 'group', 'aria-label': 'Add to selection' }, '<button type="button" data-kind="note">Comment</button><button type="button" data-kind="question">Ask Claude</button><button type="button" data-kind="detail">More detail</button>');
    const dialog = make(
      'dialog',
      { id: 'pm-dialog', class: 'pm-ui' },
      `<h3>Comments saved</h3>
       <p id="pm-done-text"></p>
       <p>Go back to Claude and say <b>“process my notes”</b>. Claude works through your comments, answers your questions in the ${NOUN}, adds the detail you asked for${KIND === 'plan' ? ', writes the guides you requested' : ''} and keeps what you ticked off. You can keep working here; it keeps saving.</p>
       <div class="pm-row"><button type="button" id="pm-export">Download notes.json</button><button type="button" id="pm-close">Close</button></div>`,
    );
    // The top bar, always on screen: the plan's name and status, then the drawing tools (one click to pick).
    const top = make(
      'div',
      { id: 'pm-top', class: 'pm-ui' },
      `<div class="pm-title"><span class="pm-kind" data-k="${KIND}">${KIND[0].toUpperCase() + KIND.slice(1)}</span><strong class="pm-title-name"></strong><span class="pm-status" hidden><span class="pm-status-dot" aria-hidden="true"></span><select id="pm-status-sel" aria-label="Status">${KIND_STATUSES[KIND].map((v) => `<option value="${v}">${STATUS_LABELS[v]}</option>`).join('')}<option disabled>──────────</option><option value="pm-remove">Remove from hub…</option></select><svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></span></div><span class="pm-top-sp"></span>`,
    );
    // The drawing tools: a floating strip of icons, docked at the left edge, that can be dragged
    // anywhere by its grip (double-click the grip to dock it again). It also carries Comments,
    // and in focus mode (F) Send to Claude and the way out, since the top bar steps aside.
    const rail = make(
      'div',
      { id: 'pm-tools', class: 'pm-ui', role: 'toolbar', 'aria-label': 'Draw', 'aria-orientation': 'vertical' },
      `<button type="button" class="pm-grip" title="Drag to move · double-click to dock" aria-label="Move the toolbar">${svg16(ICON.grip)}</button>
       <span class="pm-tsep"></span>
       ${TOOLS.map(([k, label, key, icon]) => {
         const how = k === 'select' ? 'put the pen down and read' : k === 'point' || k === 'note' ? 'click on the page' : 'drag on the page';
         return `<button type="button" data-shape="${k === 'select' ? '' : k}" aria-pressed="${k === 'select'}" aria-label="${label}" aria-keyshortcuts="${key}" title="${label} (${key}): ${how}">${svg16(icon)}</button>`;
       }).join('')}
       <span class="pm-tsep"></span>
       <button type="button" class="pm-tbtn" id="pm-t-comments" aria-pressed="false" title="Comments">${svg16(ICON.comments)}<span class="pm-tcount" id="pm-t-count" hidden></span></button>
       <button type="button" class="pm-tbtn pm-t-send" id="pm-t-send" hidden title="Send to Claude">${svg16(ICON.send)}<span class="pm-tcount" id="pm-t-send-n" hidden></span></button>
       <button type="button" class="pm-tbtn" id="pm-t-focus" aria-pressed="false" aria-keyshortcuts="F" title="Focus: just the page and this toolbar (F)">${svg16(ICON.focus)}</button>`,
    );
    // Drawings: an SVG layer for arrows, boxes and circles, HTML for points and
    // sticky notes, and a full-screen overlay that catches the pointer while drawing.
    const layer = make('div', { id: 'pm-layer', class: 'pm-ui', 'aria-hidden': 'true' });
    layer.innerHTML =
      '<svg id="pm-svg" xmlns="http://www.w3.org/2000/svg"><defs><marker id="pm-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs><g id="pm-shapes"></g><g id="pm-preview"></g></svg><div id="pm-pins"></div>';
    const overlay = make('div', { id: 'pm-overlay', class: 'pm-ui', hidden: '' });
    // Everything sits in the top bar: progress, draw tools, then save status, Notes and the main action.
    bar.classList.remove('pm-ui');
    top.append(bar);
    document.body.append(layer, overlay, panel, top, rail, pop, dialog);
    document.documentElement.classList.add('pm-has-top', 'pm-has-tools');
    ui = { panel, bar, top, rail, pop, dialog, layer, overlay, list: $('#pm-list', panel), general: $('#pm-general', panel) };
    if (READ_ONLY) {
      document.documentElement.classList.add('pm-ro');
      document.body.prepend(banner());
      $('.pm-help', panel).textContent = `The comments you wrote on v${SHOWN}. This version is read-only.`;
      ui.general.readOnly = true;
      ui.general.placeholder = 'No comment on the whole plan.';
      $('#pm-done', bar).hidden = true;
      rail.hidden = true;
      document.documentElement.classList.remove('pm-has-tools');
    }
    ui.versions = wireVersions(bar);
    wireDrawing(rail);
    wireStatus(top);
    // The plan's progress lives on its cover page: in the template's [data-pm-progress] slot,
    // else right after the page's first heading.
    let slot = root.querySelector('[data-pm-progress]');
    if (!slot) {
      slot = make('div', { class: 'pm-ui pm-progress-slot', 'data-pm-progress': '' });
      const h1 = root.querySelector('h1');
      if (h1) h1.after(slot);
      else root.prepend(slot);
    }
    slot.innerHTML = `<div id="pm-prog" class="pm-ui pm-prog" role="progressbar" aria-label="${KIND === 'plan' ? 'Phases' : 'Steps'} done" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><span class="pm-prog-track"><span class="pm-prog-fill" data-who="you"></span><span class="pm-prog-fill" data-who="claude"></span></span><span class="pm-prog-txt"></span><span class="pm-prog-lanes"></span></div><button type="button" id="pm-next" class="pm-ui pm-next" hidden><span class="pm-next-k"></span><span class="pm-next-who"></span><span class="pm-next-t"></span><span class="pm-next-go" aria-hidden="true"></span></button>`;
    // Jump to the next step to do, from the cover: it's centred on screen and flashes once.
    $('#pm-next', slot).addEventListener('click', () => {
      const next = root.querySelector('.pm-current');
      if (!next) return;
      const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      next.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
      next.classList.remove('pm-flash');
      void next.offsetWidth;
      next.classList.add('pm-flash');
      setTimeout(() => next.classList.remove('pm-flash'), 1600);
      const target = next.querySelector('.pm-done-btn, a.pm-guide-link') || next;
      if (target === next && !next.hasAttribute('tabindex')) next.tabIndex = -1;
      target.focus({ preventScroll: true });
    });

    $('#pm-toggle', bar).addEventListener('click', () => setPanel(!document.documentElement.classList.contains('pm-open')));
    $('#pm-t-comments', rail).addEventListener('click', () => setPanel(!document.documentElement.classList.contains('pm-open')));
    $('#pm-t-focus', rail).addEventListener('click', () => setFocus(!document.documentElement.classList.contains('pm-focus')));
    $('#pm-reload', bar).addEventListener('click', () => location.reload());
    wireToolbarDrag(rail);
    $('.pm-x', panel).addEventListener('click', () => setPanel(false));
    ui.general.addEventListener('input', () => {
      state.general = ui.general.value;
      save();
    });
    $('#pm-done', bar).addEventListener('click', () => {
      state.doneAt = now();
      save();
      const t = $('#pm-done-text', dialog);
      if (serverOk) {
        t.textContent = 'Your comments are in ';
        t.append(make('code', {}, ''), '.');
        t.querySelector('code').textContent = CFG.notesPath;
      } else {
        t.innerHTML = 'The review server isn’t running, so your comments are only in this browser. Click <b>Download notes.json</b> and put the file next to the plan.';
      }
      dialog.showModal();
    });
    $('#pm-close', dialog).addEventListener('click', () => dialog.close());
    $('#pm-export', dialog).addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state, null, 2) + '\n'], { type: 'application/json' });
      const a = make('a', { href: URL.createObjectURL(blob), download: 'notes.json' });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    if (!READ_ONLY) wireSelection(pop);
  }

  // ---------- versions ----------
  function banner() {
    const b = make('div', { id: 'pm-banner', class: 'pm-ui', role: 'status' });
    const cur = CFG.current ? ` (v${CFG.current})` : '';
    b.innerHTML = `<span><b>Earlier version: v${SHOWN}, read-only.</b> <span class="pm-banner-more"></span></span> <a href="">Back to the current version${cur}</a>`;
    $('.pm-banner-more', b).textContent = CFG.legacy ? 'This is the page as it was reviewed.' : `The comments you wrote on v${SHOWN} are shown.`;
    $('a', b).setAttribute('href', CFG.currentHref || '/');
    return b;
  }

  // The plan's name, and its status from the registry when the plan is registered.
  // Changing it saves through the review server; a hub showing this plan in a frame is told.
  async function wireStatus(top) {
    const name = $('.pm-title-name', top);
    const h1 = root.querySelector('h1');
    name.textContent = clip(document.title || (h1 ? visibleText(h1) : ''), 80);
    if (CFG.mode === 'standalone' || READ_ONLY) return;
    const wrap = $('.pm-status', top);
    const sel = $('select', wrap);
    const show = (s) => {
      sel.value = s;
      wrap.dataset.s = s;
    };
    try {
      const r = await fetch('/api/status', { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      if (j.stale?.length) showStale(j.stale);
      if (!j.registered) return;
      if (j.name) name.textContent = clip(j.name, 80);
      show(j.status);
      wrap.hidden = false;
    } catch {
      return;
    }
    sel.addEventListener('change', async () => {
      if (sel.value === 'pm-remove') {
        const was = wrap.dataset.s;
        show(was); // the menu shows the status until it's gone
        const title = name.textContent || 'this page';
        if (!confirm(`Remove “${title}” from the hub?\n\nIt leaves every list in the hub. The page, its notes and its versions stay where they are, and Claude can add it back.`)) return;
        const r = await fetch('/api/status', { method: 'DELETE' });
        if (!r.ok) {
          setStatus('Not removed: ' + (await r.text()));
          return;
        }
        wrap.hidden = true;
        setStatus('Removed from the hub. The page and its notes are still here.');
        if (window.parent !== window) window.parent.postMessage({ app: 'plan-maker', type: 'removed', name: title }, '*');
        return;
      }
      const r = await fetch('/api/status', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: sel.value }) });
      if (!r.ok) {
        setStatus('Status not saved: ' + (await r.text()));
        return;
      }
      const j = await r.json();
      show(j.status);
      setStatus('Status: ' + (STATUS_LABELS[j.status] || j.status));
      if (window.parent !== window) window.parent.postMessage({ app: 'plan-maker', type: 'status', status: j.status }, '*');
    });
  }

  async function wireVersions(bar) {
    let list = CFG.versions;
    if (!list && (CFG.mode === 'server' || CFG.mode === 'snapshot')) {
      try {
        const r = await fetch('/api/versions', { cache: 'no-store' });
        if (r.ok) list = (await r.json()).versions;
      } catch {}
    }
    if (!Array.isArray(list) || list.length < 2) return; // only one version: nothing to switch to
    const wrap = $('.pm-ver', bar);
    const btn = $('#pm-ver', bar);
    const menu = $('#pm-vmenu', bar);
    const fmt = (d) => {
      const t = d ? new Date(d.length === 10 ? d + 'T12:00:00' : d) : null;
      return t && !isNaN(t) ? t.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
    };
    btn.textContent = `v${SHOWN}`;
    btn.setAttribute('aria-label', `Version ${SHOWN}. Show all versions`);
    for (const v of list) {
      const a = make('a', { role: 'menuitem', href: v.href });
      a.innerHTML = '<b></b><span class="pm-vmeta"></span>';
      $('b', a).textContent = `v${v.version}`;
      $('.pm-vmeta', a).textContent = [v.current ? 'current' : 'read-only', fmt(v.date), v.summary].filter(Boolean).join(' · ');
      if (v.version === SHOWN) a.setAttribute('aria-current', 'page');
      menu.append(a);
    }
    const setOpen = (open) => {
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(menu.hidden);
    });
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setOpen(false);
    });
    wrap.hidden = false;
  }

  // ---------- links: a plan's guides, a guide's plan ----------
  // A link to another plan-maker page opens that page's own review server
  // (/api/open), or its bundled copy when this page was bundled with it (CFG.links).
  function pageHref(href) {
    if (CFG.mode === 'standalone') return CFG.links?.[href] || href;
    return '/api/open?href=' + encodeURIComponent(href);
  }

  async function loadLinks() {
    if (CFG.linkInfo) links = CFG.linkInfo;
    else if (CFG.mode !== 'standalone') {
      try {
        const r = await fetch('/api/links', { cache: 'no-store' });
        if (r.ok) links = await r.json();
      } catch {}
    }
    links = { phases: links?.phases || {}, parent: links?.parent || null };
  }

  const guideOf = (node) => (node.matches('.phase[data-guide]') ? links.phases[node.dataset.id] || { href: node.dataset.guide, exists: false } : null);

  // "Part of: <plan> › <phase>" above a guide's title, and every a[data-pm-link] in the page.
  function wireLinks() {
    $$('a[data-pm-link]', root).forEach((a) => {
      const h = a.getAttribute('href');
      if (h && !a.dataset.pmHref) {
        a.dataset.pmHref = h;
        a.href = pageHref(h);
      }
    });
    const ph = meta('pm-parent');
    if (!ph) return;
    const p = links.parent || {};
    const a = make('a', { class: 'pm-ui pm-parent', href: pageHref(ph) });
    a.innerHTML = '<span class="pm-parent-lbl">Part of</span><b></b><span class="pm-parent-phase"></span>';
    $('b', a).textContent = p.name || meta('pm-parent-name') || 'the plan';
    if (p.phase) $('.pm-parent-phase', a).textContent = p.phase;
    else $('.pm-parent-phase', a).remove();
    const h1 = root.querySelector('h1');
    if (h1) h1.before(a);
    else root.prepend(a);
  }

  // A reference whose source files changed after it was written says so on its cover.
  function showStale(list) {
    const slot = root.querySelector('[data-pm-progress]');
    if (!slot || $('.pm-stale', slot)) return;
    const n = make('div', { class: 'pm-ui pm-stale', role: 'status' });
    n.innerHTML = '<b>Out of date.</b> <span class="pm-stale-files"></span> Ask Claude to refresh it, or comment on what changed.';
    $('.pm-stale-files', n).textContent = `${list.join(', ')} changed since this was written.`;
    slot.append(n);
  }

  // Elements the latest revision changed carry data-changed="v<N>": badge them on v<N>.
  function markChanged() {
    $$('[data-changed]', root).forEach((node) => {
      const v = parseInt(String(node.dataset.changed).replace(/^v/i, ''), 10);
      if (!SHOWN || v !== SHOWN) return;
      const badge = make('span', { class: 'pm-ui pm-changed', title: `Changed in v${v}` });
      badge.textContent = `Updated in v${v}`;
      if (node.tagName === 'TR') (node.cells[0] || node).prepend(badge);
      else if (node.matches('table, pre')) (node.closest('.table-wrap') || node).before(badge);
      else {
        const h = node.matches(HEADINGS) ? node : node.querySelector(HEADINGS);
        if (h) h.append(badge);
        else node.prepend(badge);
      }
    });
  }

  const setStatus = (s) => {
    const el = $('#pm-status');
    if (el) el.textContent = s;
  };
  function setPanel(open) {
    document.documentElement.classList.toggle('pm-open', open);
    $('#pm-t-comments')?.setAttribute('aria-pressed', String(open));
    layoutDrawings(); // the open panel narrows the page on wide screens
  }

  // ---------- selection → note ----------
  let pending = null;
  function wireSelection(pop) {
    let pointerDown = false;
    let timer = null;
    const hide = () => {
      pop.style.display = 'none';
    };
    const check = () => {
      if (locked) return hide();
      const sel = getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return hide();
      const range = sel.getRangeAt(0);
      const anc = range.commonAncestorContainer;
      const ancEl = anc.nodeType === 1 ? anc : anc.parentElement;
      if (!ancEl || ancEl.closest('.pm-ui') || !root.contains(ancEl)) return hide();
      const block = ancEl.closest('[data-id]');
      if (!block || !root.contains(block)) return hide();
      const start = offsetIn(block, range.startContainer, range.startOffset);
      const end = offsetIn(block, range.endContainer, range.endOffset);
      const quote = visibleText(block).slice(start, end);
      if (!quote.trim()) return hide();
      pending = { blockId: block.dataset.id, start, end, quote };
      const rect = range.getBoundingClientRect();
      pop.style.display = 'block';
      const w = pop.offsetWidth;
      const vw = document.documentElement.clientWidth;
      const left = Math.min(Math.max(8, rect.left + rect.width / 2 - w / 2), vw - w - 8);
      pop.style.left = scrollX + left + 'px';
      pop.style.top = scrollY + rect.bottom + 8 + 'px';
    };
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('#pm-pop')) pointerDown = true;
    });
    document.addEventListener('pointerup', () => {
      pointerDown = false;
    });
    document.addEventListener('mouseup', (e) => {
      pointerDown = false;
      if (e.target.closest && e.target.closest('.pm-ui')) return;
      setTimeout(check, 0);
    });
    // Touch selection (long-press, drag handles) fires no mouseup.
    document.addEventListener('selectionchange', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!pointerDown) check();
      }, 300);
    });
    // Act on pointerdown so a touch tap can't clear the selection first.
    // The popover offers "Add note" and "Ask"; data-kind says which.
    const kindOf = (e) => e.target.closest?.('button')?.dataset.kind || 'note';
    pop.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      addHighlight(kindOf(e));
    });
    pop.addEventListener('mousedown', (e) => e.preventDefault());
    pop.addEventListener('click', (e) => addHighlight(kindOf(e)));
    function addHighlight(kind) {
      if (!pending) return;
      const p = pending;
      pending = null;
      const block = byId(p.blockId);
      const h = {
        id: Math.random().toString(36).slice(2, 9),
        n: nextN(),
        blockId: p.blockId,
        where: labelFor(block),
        quote: p.quote,
        start: p.start,
        end: p.end,
        note: '',
        createdAt: now(),
      };
      h.kind = kind || 'note';
      getSelection().removeAllRanges();
      hide();
      state.highlights.push(h);
      paintHighlight(h);
      setPanel(true);
      save();
      renderList();
      focusNote('h:' + h.id, true);
    }
  }

  // ---------- items, sections, decisions ----------
  function ensureItem(id) {
    const node = byId(id);
    const it = state.items[id] || (state.items[id] = { where: '', note: '' });
    it.where = labelFor(node);
    it.excerpt = excerpt(node);
    return it;
  }

  function openItemNote(id, kind) {
    const it = ensureItem(id);
    it.noteOpen = true;
    if (kind || !it.kind) it.kind = kind || 'note';
    paintItem(id);
    setPanel(true);
    save();
    renderList();
    focusNote('i:' + id, true);
  }

  // Who a step belongs to: data-who, else a .who tag inside it (0.2 guides), else the reader.
  function whoOf(node) {
    const w = (node.dataset.who || '').toLowerCase();
    if (['you', 'claude', 'both'].includes(w)) return w;
    const tag = node.querySelector('.who.claude, .who.both, .who.you');
    if (tag) return tag.classList.contains('claude') ? 'claude' : tag.classList.contains('both') ? 'both' : 'you';
    return 'you';
  }
  const STATUS = { todo: 'To do', doing: 'In progress', done: 'Done' };
  const statusOf = (node) => (STATUS[(node.dataset.status || '').toLowerCase()] ? node.dataset.status.toLowerCase() : 'todo');

  function decorate() {
    $$(`.item[data-id], ${UNIT}`, root).forEach((node) => {
      if (node.closest('.pm-ui')) return;
      const id = node.dataset.id;
      const isStep = node.matches(UNIT);
      const isPhase = isStep && node.matches('.phase');
      const who = isStep ? whoOf(node) : null;
      const guide = isPhase ? guideOf(node) : null;
      node.classList.add('pm-item');
      if (isStep) {
        node.classList.add('pm-step');
        node.dataset.pmWho = who;
        if (who === 'claude') node.dataset.pmStatus = statusOf(node);
      }
      const parts = [];
      if (guide) parts.push(guideLink(guide));
      else if (isStep && who !== 'claude') parts.push('<button type="button" class="pm-done-btn" aria-pressed="false">Mark done</button>');
      if (isStep && who === 'claude') {
        parts.push(`<span class="pm-status-tag" data-s="${statusOf(node)}">${STATUS[statusOf(node)]}</span>`);
        // Claude sets its own status; the reader can still mark the work done themselves.
        if (statusOf(node) !== 'done') parts.push('<button type="button" class="pm-done-btn" data-who="claude" aria-pressed="false" title="Mark Claude’s work done yourself">Mark done</button>');
      }
      parts.push('<span class="pm-sp"></span><button type="button" class="pm-note-btn">Comment</button><button type="button" class="pm-detail-btn">More detail</button>');
      if (isPhase && !guide) parts.push('<button type="button" class="pm-guide-btn">Make a guide</button>');
      const ctl = make('div', { class: 'pm-ui pm-ctl', role: 'group', 'aria-label': isPhase ? 'Phase' : isStep ? 'Step' : 'Comment' }, parts.join(''));
      if (node.tagName === 'TR') (node.lastElementChild || node).appendChild(ctl);
      else if (node.matches('table, pre')) {
        (node.closest('.table-wrap') || node).after(ctl);
        ctl.dataset.for = id;
      } else node.appendChild(ctl);
      if (READ_ONLY) ctl.querySelectorAll('button').forEach((b) => (b.disabled = true));
      ctl.addEventListener('click', (e) => {
        if (READ_ONLY) return;
        const b = e.target.closest('button');
        if (!b) return;
        if (b.classList.contains('pm-note-btn')) return openItemNote(id, state.items[id]?.kind);
        if (b.classList.contains('pm-detail-btn')) return openItemNote(id, 'detail');
        if (b.classList.contains('pm-guide-btn')) return openItemNote(id, 'guide');
        if (b.classList.contains('pm-done-btn')) {
          const nowDone = !state.steps[id]?.done;
          if (!nowDone) delete state.steps[id];
          else state.steps[id] = { done: true, doneAt: now(), where: labelFor(node) };
          paintItem(id);
          renderProgress();
          save();
          // A guide is followed: once a step is done, bring the next one into view.
          if (nowDone && KIND === 'guide') {
            const next = root.querySelector('.pm-current');
            const r = next?.getBoundingClientRect();
            if (r && (r.top < 0 || r.top > innerHeight * 0.6)) {
              const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
              next.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
            }
          }
        }
      });
      ctls.set(id, ctl);
    });
    decorateCode();

    let secs = $$('section[data-id]', root).filter((s) => !s.closest('.pm-ui'));
    if (!secs.length && autoMode) secs = $$('h2[data-id]', root);
    secs.forEach((sec) => {
      const id = sec.dataset.id;
      const b = make('button', { type: 'button', class: 'pm-ui pm-sec-note', 'aria-label': 'Comment on this section' });
      if (READ_ONLY) b.disabled = true;
      else b.addEventListener('click', () => openItemNote(id));
      const h = sec.matches(HEADINGS) ? sec : sec.querySelector(HEADINGS);
      if (h) h.after(b);
      else sec.prepend(b);
      secBtns.set(id, b);
    });

    $$('.decision', root).forEach((d) => {
      const key = d.dataset.decision || d.dataset.id;
      const q = clip(visibleText(d.querySelector(HEADINGS) || d), 160);
      const recInput = $$('input[type=radio]', d).find((r) => r.closest('label')?.querySelector('.rec'));
      const ensure = () => {
        const dd = state.decisions[key] || (state.decisions[key] = { question: q, choice: null, label: null, note: '' });
        dd.question = q;
        if (recInput) dd.recommended = recInput.value;
        return dd;
      };
      const ta = make('textarea', { class: 'pm-ui pm-dnote', rows: '2', placeholder: READ_ONLY ? 'No note.' : 'Optional note on this decision…' });
      d.append(ta);
      if (READ_ONLY) {
        ta.readOnly = true;
        $$('input', d).forEach((r) => (r.disabled = true));
        return;
      }
      ta.addEventListener('input', () => {
        ensure().note = ta.value;
        save();
      });
      $$('input[type=radio]', d).forEach((r) =>
        r.addEventListener('change', () => {
          const dd = ensure();
          dd.choice = r.value;
          const l = r.closest('label');
          dd.label = l ? clip(visibleText(l.querySelector('b, strong') || l), 120) : r.value;
          paintDecision(d);
          save();
        }),
      );
    });
  }

  // A phase handed to a guide: a link to the guide and how far along it is.
  function guideLink(g) {
    const total = (g.you?.total || 0) + (g.claude?.total || 0);
    const done = (g.you?.done || 0) + (g.claude?.done || 0);
    const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const prog = !g.exists ? 'Not written yet' : g.done ? 'Done' : total ? `${done} of ${total} steps done` : 'No steps yet';
    const name = g.exists ? g.name || 'Guide' : 'Guide';
    return `<a class="pm-guide-link${g.done ? ' pm-on' : ''}" href="${esc(pageHref(g.href))}"><span class="pm-guide-name">${esc(name)}</span><span class="pm-guide-prog">${esc(prog)}</span></a>`;
  }

  // The clipboard API is refused in some places: a frame not allowed to write
  // (the hub embeds pages), or plain http from another device. The older copy
  // command still works there, from a click.
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
    const ta = make('textarea', { class: 'pm-ui', 'aria-hidden': 'true', readonly: '' });
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.append(ta);
    const sel = getSelection();
    const kept = sel.rangeCount ? sel.getRangeAt(0) : null;
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    sel.removeAllRanges();
    if (kept) sel.addRange(kept);
    return ok;
  }

  // Every code block gets a Copy button.
  function decorateCode() {
    $$('pre', root).forEach((pre) => {
      if (pre.closest('.pm-ui, [data-no-annotate]') || pre.querySelector(':scope > .pm-copy')) return;
      const b = make('button', { type: 'button', class: 'pm-ui pm-copy' }, 'Copy');
      b.addEventListener('click', async () => {
        const text = visibleText(pre).replace(/\n$/, '');
        const ok = await copyText(text);
        if (!ok) {
          const r = document.createRange();
          r.selectNodeContents(pre.querySelector('code') || pre);
          getSelection().removeAllRanges();
          getSelection().addRange(r);
        }
        b.textContent = ok ? 'Copied' : 'Press ⌘C';
        b.classList.toggle('pm-ok', ok);
        setTimeout(() => {
          b.textContent = 'Copy';
          b.classList.remove('pm-ok');
        }, 1400);
      });
      pre.classList.add('pm-has-copy');
      pre.prepend(b);
    });
  }

  // Whether a unit is done: Claude's from the status Claude set, a phase handed to a guide
  // when the guide is done, the reader's from Mark done.
  function isDone(n) {
    if (whoOf(n) === 'claude') return statusOf(n) === 'done' || !!state.steps[n.dataset.id]?.done;
    const g = n.matches('.phase') ? guideOf(n) : null;
    if (g?.exists) return !!g.done;
    return !!state.steps[n.dataset.id]?.done;
  }
  const units = () => $$(UNIT, root).filter((n) => !n.closest('.pm-ui'));

  // ---------- the contents rail shows where you are ----------
  // On a plan split into parts, Steps lists every phase (or step); on any page, a link to a
  // section with steps in it carries a marker: a ring to do, half done, a check when done.
  const rail = [];
  function buildRail() {
    const nav = document.querySelector('nav.toc');
    if (!nav) return;
    const stepsPart = document.getElementById('steps');
    const head = nav.querySelector('a.toc-part[href="#steps"]');
    if (head && stepsPart?.classList.contains('part')) {
      for (let a = head.nextElementSibling; a && !a.classList.contains('toc-part'); ) {
        const next = a.nextElementSibling;
        if (a.matches('a')) a.remove();
        a = next;
      }
      let at = head;
      const group = { head, links: [] };
      for (const u of units().filter((n) => stepsPart.contains(n))) at = railLink(u, at, group);
      railGroups.push(group);
    }
    // Elsewhere (a guide, or a plan without parts), a section with steps becomes a heading in the
    // rail with its steps listed beneath it, the way a plan's Steps lists its phases.
    for (const a of $$('a[href^="#"]:not(.toc-part):not(.pm-rail-step)', nav)) {
      const target = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
      const nodes = target ? units().filter((n) => target.contains(n)) : [];
      if (!nodes.length) continue;
      a.classList.add('pm-rail-sec');
      let at = a;
      const group = { head: a, links: [] };
      for (const u of nodes) at = railLink(u, at, group);
      railGroups.push(group);
    }
    if (rail.length) {
      nav.classList.add('pm-rail');
      if (nav.querySelector('.pm-rail-sec')) nav.classList.add('pm-rail-grouped');
    }
  }
  function railLink(u, after, group) {
    if (!u.id && !document.getElementById(u.dataset.id)) u.id = u.dataset.id;
    const h = u.querySelector('h1, h2, h3, h4, h5, h6');
    const a = make('a', { href: '#' + (u.id || ''), class: 'pm-rail-step' });
    a.textContent = clip(visibleText(h || u).trim(), 60);
    a.addEventListener('click', (e) => {
      unfold(u);
      if (!u.id) { e.preventDefault(); u.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    });
    after.after(a);
    rail.push({ a, nodes: [u] });
    group?.links.push({ a, node: u });
    return a;
  }
  function paintRail() {
    for (const { a, nodes } of rail) {
      const done = nodes.filter(isDone).length;
      const cur = nodes.some((n) => n.classList.contains('pm-current'));
      a.dataset.pmState = done === nodes.length ? 'done' : cur ? 'current' : done ? 'partial' : 'todo';
      if (nodes.length > 1) a.title = `${done} of ${nodes.length} done`;
      else a.title = done ? 'Done' : cur ? 'Next' : 'To do';
    }
    // In each group, what's done folds into one row ("✓ 4 done") that opens with a click.
    for (const g of railGroups) {
      const done = g.links.filter((l) => isDone(l.node));
      if (!g.fold) {
        g.fold = make('button', { type: 'button', class: 'pm-ui pm-rail-fold' });
        g.fold.addEventListener('click', () => { g.open = !g.open; paintRail(); });
        g.head.after(g.fold);
      }
      const all = done.length === g.links.length;
      const fold = done.length >= 2 || (all && done.length);
      g.fold.hidden = !fold;
      const shut = fold && !g.open;
      for (const l of g.links) l.a.hidden = shut && isDone(l.node);
      g.fold.dataset.open = String(!!g.open);
      g.fold.setAttribute('aria-expanded', String(!!g.open));
      g.fold.textContent = g.open ? `Hide ${done.length} done` : all ? `All ${done.length} done` : `${done.length} done`;
    }
  }
  const railGroups = [];

  // ---------- finished work folds away on the page ----------
  // A section whose steps are all done keeps its heading and lede and folds the rest behind one
  // line; elsewhere a finished group of steps (.steps) or a finished phase card folds the same way.
  // A fold opens with one click and stays open until closed. Hidden steps still count in the numbering.
  const openFolds = new Set();
  function foldButton(key, n, word, place) {
    const b = make('button', { type: 'button', class: 'pm-ui pm-fold', 'data-fold': key });
    b.addEventListener('click', () => {
      if (openFolds.has(key)) openFolds.delete(key);
      else openFolds.add(key);
      paintFolds();
    });
    place(b);
    return b;
  }
  const folds = new Map();
  // Open every fold that hides this node, so a link to it lands on something visible.
  function unfold(node) {
    let changed = false;
    for (const [key, f] of folds) if (f.el.classList.contains('pm-folded') && f.el.contains(node) && f.el !== node) { openFolds.add(key); changed = true; }
    if (changed) paintFolds();
  }
  function paintFolds() {
    if (KIND === 'reference') return;
    const all = units();
    const doneIn = (el) => { const u = all.filter((n) => el.contains(n)); return { n: u.length, done: u.length > 0 && u.every(isDone) }; };
    const label = (n, word, open) => (open ? `Hide the ${n} done ${word}${n === 1 ? '' : 's'}` : `All ${n} ${word}${n === 1 ? '' : 's'} done`);
    const seen = new Set();
    const set = (key, el, n, word, folded, place, counted) => {
      seen.add(key);
      let f = folds.get(key);
      if (!f) { f = { el, b: foldButton(key, n, word, place) }; folds.set(key, f); }
      const open = openFolds.has(key);
      el.classList.toggle('pm-folded', folded && !open);
      f.b.hidden = !folded;
      f.b.textContent = label(n, word, open);
      f.b.setAttribute('aria-expanded', String(open));
      // Hidden steps don't count themselves: the fold line counts them, so later numbers stay put.
      f.b.style.counterIncrement = folded && !open && counted ? `sub ${n}` : '';
    };
    for (const sec of $$('section.sec', root)) {
      const { n, done } = doneIn(sec);
      if (!n) continue;
      const word = sec.querySelector('.phase') ? 'phase' : 'step';
      const lede = sec.querySelector(':scope > .lede') || sec.querySelector(':scope > h2');
      set('sec:' + (sec.id || sec.dataset.id), sec, n, word, done, (b) => lede.after(b), true);
      // Groups and phases fold only inside a section that isn't finished: opening a finished
      // section shows everything in it at once.
      const secOpen = !done;
      for (const g of $$('.steps', sec)) {
        const r = doneIn(g);
        if (!r.n) continue;
        const key = 'grp:' + (g.querySelector('[data-id]')?.dataset.id || '');
        set(key, g, r.n, 'step', r.done && secOpen, (b) => { b.classList.add('pm-fold-grp'); g.before(b); }, true);
      }
      for (const ph of $$('.phase[data-id]', sec)) {
        set('ph:' + ph.dataset.id, ph, 1, 'phase', isDone(ph) && secOpen, (b) => (ph.querySelector(':scope > h3') || ph.firstElementChild).after(b), false);
      }
    }
    for (const [key, f] of folds) if (!seen.has(key)) f.b.hidden = true;
  }

  // Each owner's progress.
  function laneCounts() {
    const out = { you: { done: 0, total: 0 }, claude: { done: 0, total: 0 } };
    for (const n of units()) {
      const lane = out[whoOf(n) === 'claude' ? 'claude' : 'you'];
      lane.total++;
      if (isDone(n)) lane.done++;
    }
    return out;
  }

  // One bar for the whole plan: the reader's done steps fill it in blue, Claude's in gold.
  // The first step not done yet, whoever owns it, is marked as the current one.
  function renderProgress() {
    const prog = $('#pm-prog');
    if (!prog) return;
    const { you, claude } = laneCounts();
    const total = you.total + claude.total;
    const done = you.done + claude.done;
    prog.hidden = !total;
    const pct = (n) => (total ? (n / total) * 100 : 0);
    $('.pm-prog-fill[data-who="you"]', prog).style.width = pct(you.done) + '%';
    $('.pm-prog-fill[data-who="claude"]', prog).style.width = pct(claude.done) + '%';
    const word = units().every((n) => n.matches('.phase')) ? 'phases' : 'steps';
    $('.pm-prog-txt', prog).innerHTML = `<b>${done}</b> of ${total} ${word} done`;
    $('.pm-prog-lanes', prog).innerHTML = [
      you.total ? `<span class="pm-lane" data-who="you">You: ${you.done} of ${you.total}</span>` : '',
      claude.total ? `<span class="pm-lane" data-who="claude">Claude: ${claude.done} of ${claude.total}</span>` : '',
    ].join('');
    prog.title = `You: ${you.done} of ${you.total} done. Claude: ${claude.done} of ${claude.total} done.`;
    prog.dataset.you = `${you.done}/${you.total}`;
    prog.dataset.claude = `${claude.done}/${claude.total}`;
    prog.setAttribute('aria-valuenow', String(Math.round(pct(done))));
    let current = null;
    for (const n of units()) {
      n.classList.remove('pm-current');
      // Mark done, a phase's guide finished, or Claude's status.
      n.classList.toggle('pm-step-done', isDone(n));
      if (!isDone(n) && !current) current = n;
    }
    current?.classList.add('pm-current');
    paintRail();
    paintFolds();
    const next = $('#pm-next');
    if (next) {
      next.hidden = !current;
      if (current) {
        const who = whoOf(current);
        next.dataset.who = who === 'claude' ? 'claude' : 'you';
        $('.pm-next-k', next).textContent = current.matches('.phase') ? 'Next phase' : 'Next step';
        $('.pm-next-who', next).textContent = { you: 'You', claude: 'Claude', both: 'You, with Claude' }[who];
        const h = current.querySelector('h1, h2, h3, h4, h5, h6');
        $('.pm-next-t', next).textContent = clip(visibleText(h || current), 80);
        next.title = 'Go to it';
      }
    }
  }

  function paintItem(id) {
    const it = state.items[id];
    const node = byId(id);
    if (!node) return;
    const open = !!(it && (it.note || it.noteOpen || it.kind === 'detail' || it.kind === 'guide'));
    const done = !!state.steps?.[id]?.done;
    const ctl = ctls.get(id);
    if (ctl) {
      const db = ctl.querySelector('.pm-done-btn');
      if (db) {
        const byYou = db.dataset.who === 'claude';
        db.textContent = done ? (byYou ? 'Marked done by you' : 'Done') : 'Mark done';
        db.setAttribute('aria-pressed', String(done));
        db.classList.toggle('pm-on', done);
      }
      // A Claude step marked done by the reader shows as done, whatever Claude last set.
      const tag = ctl.querySelector('.pm-status-tag');
      if (tag) {
        const s = done ? 'done' : statusOf(node);
        tag.dataset.s = s;
        tag.textContent = STATUS[s];
        tag.hidden = done;
      }
      const nb = ctl.querySelector('.pm-note-btn');
      nb.classList.toggle('pm-has', open);
      nb.dataset.k = open ? it.kind || 'note' : '';
      nb.textContent = open ? { question: 'Your question', detail: 'More detail asked', guide: 'Guide requested' }[it.kind] || 'Your comment' : 'Comment';
      // With a note open, its one button says what it is; the other asks wait.
      ctl.querySelectorAll('.pm-detail-btn, .pm-guide-btn').forEach((b) => (b.hidden = open));
      ctl.classList.toggle('pm-active', open || done);
    }
    node.classList.toggle('pm-step-done', node.matches(UNIT) ? isDone(node) : done);
    node.classList.toggle('pm-noted', !!it?.note);
    secBtns.get(id)?.classList.toggle('pm-has', open);
  }

  function paintDecision(d) {
    const dd = state.decisions[d.dataset.decision || d.dataset.id];
    $$('input[type=radio]', d).forEach((r) => {
      r.checked = dd?.choice === r.value;
      r.closest('label')?.classList.toggle('pm-chosen', r.checked);
    });
    const ta = $('textarea.pm-dnote', d);
    if (ta && dd?.note && ta.value !== dd.note) ta.value = dd.note;
  }

  // ---------- notes panel ----------
  function docOrder(id) {
    const node = byId(id);
    return node ? $$('[data-id]', root).indexOf(node) : 1e9;
  }

  // A note that asks something of Claude: a comment or question with words, or a request
  // for more detail or a guide, which needs none.
  const counts = (x) => !!(x && (x.note || x.kind === 'detail' || x.kind === 'guide'));

  function renderSummary() {
    const items = Object.values(state.items);
    const v = items.reduce((a, it) => {
      if (it.verdict) a[it.verdict] = (a[it.verdict] || 0) + 1;
      return a;
    }, {});
    const written = [...state.highlights, ...items, ...state.drawings].filter(counts);
    const by = (k) => written.filter((x) => x.kind === k).length;
    const marks = state.drawings.filter((d) => !d.note).length;
    const decided = Object.values(state.decisions).filter((d) => d.choice).length;
    const total = $$('.decision', root).length;
    const lanes = laneCounts();
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    const parts = [plural(written.length - by('question') - by('detail') - by('guide'), 'comment')];
    if (by('question')) parts.push(plural(by('question'), 'question'));
    if (by('detail')) parts.push(`${by('detail')} more detail`);
    if (by('guide')) parts.push(plural(by('guide'), 'guide') + ' requested');
    for (const k of ['keep', 'change', 'cut']) if (v[k]) parts.push(`${v[k]} ${k}`);
    if (marks) parts.push(plural(marks, 'mark'));
    if (total) parts.push(`${decided}/${total} decisions`);
    const word = units().every((n) => n.matches('.phase')) ? 'phases' : 'steps';
    if (lanes.you.total) parts.push(`${lanes.you.done}/${lanes.you.total} of your ${word} done`);
    $('#pm-summary').textContent = parts.join(' · ');
    const n = written.length + marks + (v.change || 0) + (v.cut || 0);
    $('#pm-count').textContent = n;
    $('#pm-t-count').textContent = n;
    $('#pm-t-count').hidden = !n;
    // What Send to Claude hands over: every note, mark and answered decision, and the note on the whole page.
    sendCount = n + decided + (String(state.general || '').trim() ? 1 : 0);
    paintSend();
  }

  const PLACEHOLDER = {
    note: 'Your comment…',
    question: 'What do you want to know?',
    detail: 'What do you want more on? (optional)',
    guide: 'Anything the guide should assume or cover? (optional)',
  };

  function renderList() {
    const entries = [];
    state.highlights.forEach((h) => entries.push({ key: 'h:' + h.id, order: docOrder(h.blockId) + (h.start || 0) / 1e6, h }));
    Object.entries(state.items).forEach(([id, it]) => {
      if (counts(it) || (it.noteOpen && !READ_ONLY) || (READ_ONLY && it.verdict)) entries.push({ key: 'i:' + id, order: docOrder(id), id, it });
    });
    state.drawings.forEach((d) => entries.push({ key: 'd:' + d.id, order: (d.blockId ? docOrder(d.blockId) : 0) + (d.y1 || 0) / 1e3, d }));
    entries.sort((a, b) => a.order - b.order);
    const list = ui.list;
    list.innerHTML = '';
    if (!entries.length) {
      list.innerHTML = READ_ONLY
        ? '<p class="pm-empty">No comments on this version.</p>'
        : '<p class="pm-empty">No comments yet. Select text and choose Comment or Ask Claude, or use Comment on any block.</p>';
    }
    for (const e of entries) {
      const box = make('div', { class: 'pm-note', 'data-key': e.key });
      box.innerHTML = `<div class="pm-nh"><span class="pm-num"></span><button type="button" class="pm-where"></button><button type="button" class="pm-del">Delete</button></div>`;
      const where = $('.pm-where', box);
      const ta = make('textarea');
      const entry = e.h || e.it || e.d;
      // What the note asks of Claude: a comment, a question (answered where it was asked),
      // more detail, or (on a plan's phase) a guide of its own.
      {
        if (!entry.kind) entry.kind = 'note';
        const kinds = make('div', { class: 'pm-kinds', role: 'group', 'aria-label': 'Kind' });
        const options = [['note', 'Comment'], ['question', 'Question'], ['detail', 'More detail']];
        if (e.id && byId(e.id)?.matches('.phase[data-who]') && !byId(e.id).dataset.guide) options.push(['guide', 'Make a guide']);
        else if (entry.kind === 'guide') entry.kind = 'note';
        for (const [k, label] of options) {
          const kb = make('button', { type: 'button', 'data-k': k, 'aria-pressed': String(entry.kind === k) });
          kb.textContent = label;
          kb.classList.toggle('pm-on', entry.kind === k);
          if (READ_ONLY) kb.disabled = true;
          kb.addEventListener('click', () => {
            entry.kind = k;
            $$('button', kinds).forEach((x) => {
              x.classList.toggle('pm-on', x === kb);
              x.setAttribute('aria-pressed', String(x === kb));
            });
            ta.placeholder = PLACEHOLDER[k];
            if (e.id) paintItem(e.id);
            save();
          });
          kinds.append(kb);
        }
        box.append(kinds);
      }
      if (e.d) {
        $('.pm-num', box).textContent = e.d.n;
        where.textContent = `${SHAPES[e.d.shape] || 'Mark'} · ${e.d.where || 'Page'}`;
        ta.placeholder = e.d.shape === 'note' ? 'Your sticky note…' : 'What is this mark about? (optional)';
        ta.value = e.d.note || '';
        ta.addEventListener('input', () => {
          e.d.note = ta.value;
          layoutDrawings();
          save();
        });
        where.addEventListener('click', () => {
          const el = ui.layer.querySelector(`[data-d="${CSS.escape(e.d.id)}"]`);
          if (el) {
            const r = el.getBoundingClientRect();
            scrollTo({ top: scrollY + r.top - innerHeight / 3, behavior: 'smooth' });
            hotDrawing(e.d.id);
          }
        });
        $('.pm-del', box).addEventListener('click', () => {
          state.drawings = state.drawings.filter((x) => x !== e.d);
          layoutDrawings();
          save();
          renderList();
        });
      } else if (e.h) {
        $('.pm-num', box).textContent = e.h.n;
        where.textContent = e.h.where + (e.h.orphaned ? ' (text no longer found)' : '');
        const q = make('blockquote');
        q.textContent = e.h.quote;
        box.append(q);
        ta.placeholder = 'Your comment on the highlighted text…';
        ta.value = e.h.note || '';
        ta.addEventListener('input', () => {
          e.h.note = ta.value;
          save();
        });
        where.addEventListener('click', () => jump(`mark.pm-hl[data-h="${CSS.escape(e.h.id)}"]`, e.h.id));
        $('.pm-del', box).addEventListener('click', () => {
          state.highlights = state.highlights.filter((x) => x !== e.h);
          unpaintHighlight(e.h.id);
          save();
          renderList();
        });
      } else {
        $('.pm-num', box).textContent = '';
        $('.pm-num', box).classList.add('pm-num-item');
        where.textContent = (e.it.where || e.id) + (e.it.verdict ? ` (${e.it.verdict[0].toUpperCase()}${e.it.verdict.slice(1)})` : '');
        ta.placeholder = 'Your comment…';
        ta.value = e.it.note || '';
        ta.addEventListener('input', () => {
          e.it.note = ta.value;
          paintItem(e.id);
          save();
        });
        where.addEventListener('click', () => jump(`[data-id="${CSS.escape(e.id)}"]`));
        $('.pm-del', box).addEventListener('click', () => {
          e.it.note = '';
          e.it.noteOpen = false;
          delete e.it.kind;
          paintItem(e.id);
          save();
          renderList();
        });
      }
      if (entry.kind !== 'note' && PLACEHOLDER[entry.kind]) ta.placeholder = PLACEHOLDER[entry.kind];
      if (READ_ONLY) {
        ta.readOnly = true;
        $('.pm-del', box).remove();
        if (!ta.value) ta.hidden = true;
      }
      box.append(ta);
      list.append(box);
    }
    renderSummary();
  }

  function focusNote(key, edit) {
    const box = ui.list.querySelector(`.pm-note[data-key="${CSS.escape(key)}"]`);
    if (!box) return;
    $$('.pm-note.pm-hot').forEach((n) => n.classList.remove('pm-hot'));
    box.classList.add('pm-hot');
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (edit) box.querySelector('textarea')?.focus({ preventScroll: true });
    $$('mark.pm-hl.pm-hot').forEach((m) => m.classList.remove('pm-hot'));
    if (key.startsWith('h:')) $$(`mark.pm-hl[data-h="${CSS.escape(key.slice(2))}"]`).forEach((m) => m.classList.add('pm-hot'));
    hotDrawing(key.startsWith('d:') ? key.slice(2) : null);
  }

  // ---------- drawings: arrows, boxes, circles, points, sticky notes ----------
  // Each drawing is anchored to the block under its start point (data-id, or
  // the plan itself) and stored as fractions of that block's box, so it stays
  // on the same content when the page reflows or is opened on a phone.
  const nextN = () => [...state.highlights, ...state.drawings].reduce((m, x) => Math.max(m, x.n || 0), 0) + 1;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs) => {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };

  function pageBox(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, w: Math.max(r.width, 1), h: Math.max(r.height, 1) };
  }

  /** The annotatable block at a viewport point (the overlay is out of the way while asking). */
  function anchorAt(cx, cy) {
    const ov = ui.overlay;
    const was = ov.style.display;
    ov.style.display = 'none';
    let el = document.elementFromPoint(cx, cy);
    ov.style.display = was;
    if (el && el.closest('.pm-ui')) el = null;
    const block = el && root.contains(el) ? el.closest('[data-id]') : null;
    return block && root.contains(block) ? block : root;
  }

  function toPage(d) {
    const anchor = (d.blockId && byId(d.blockId)) || root;
    const b = pageBox(anchor);
    const p = { x1: b.x + d.x1 * b.w, y1: b.y + d.y1 * b.h, x2: b.x + d.x2 * b.w, y2: b.y + d.y2 * b.h };
    if (Array.isArray(d.points)) p.points = d.points.map(([x, y]) => [b.x + x * b.w, b.y + y * b.h]);
    return p;
  }

  function drawShape(g, shape, p, attrs = {}) {
    const x = Math.min(p.x1, p.x2);
    const y = Math.min(p.y1, p.y2);
    const w = Math.abs(p.x2 - p.x1);
    const h = Math.abs(p.y2 - p.y1);
    if (shape === 'arrow') g.append(svgEl('line', { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, 'marker-end': 'url(#pm-head)', ...attrs }));
    else if (shape === 'box') g.append(svgEl('rect', { x, y, width: w, height: h, rx: 6, ...attrs }));
    else if (shape === 'circle') g.append(svgEl('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: Math.max(w / 2, 1), ry: Math.max(h / 2, 1), ...attrs }));
    else if (shape === 'pen' && p.points?.length) g.append(svgEl('polyline', { points: p.points.map((q) => q.join(',')).join(' '), ...attrs }));
  }

  function layoutDrawings() {
    if (!ui?.layer) return;
    const svg = $('#pm-svg', ui.layer);
    const doc = document.documentElement;
    // Size the layer to the page (not past it, so a mark near the edge can't widen the page on a phone).
    ui.layer.style.height = '0px';
    const pageW = doc.clientWidth;
    const pageH = Math.max(doc.scrollHeight, document.body.scrollHeight);
    ui.layer.style.height = pageH + 'px';
    svg.setAttribute('width', pageW);
    svg.setAttribute('height', pageH);
    const shapes = $('#pm-shapes', svg);
    const pins = $('#pm-pins', ui.layer);
    shapes.textContent = '';
    pins.textContent = '';
    for (const d of state.drawings) {
      const p = toPage(d);
      const open = () => {
        setPanel(true);
        focusNote('d:' + d.id);
      };
      if (d.shape === 'point' || d.shape === 'note') {
        const pin = make('button', { type: 'button', class: `pm-pin pm-pin-${d.shape}`, 'data-d': d.id, title: d.note || SHAPES[d.shape] });
        pin.style.left = p.x1 + 'px';
        pin.style.top = p.y1 + 'px';
        const n = make('span', { class: 'pm-pin-n' });
        n.textContent = d.n;
        pin.append(n);
        if (d.shape === 'note') {
          const t = make('span', { class: 'pm-pin-text' });
          t.textContent = d.note || 'Sticky note';
          pin.append(t);
          // Near the right edge the note opens to the left of its pin instead.
          if (p.x1 + 250 > pageW) pin.classList.add('pm-pin-flip');
        }
        pin.addEventListener('click', open);
        pins.append(pin);
        continue;
      }
      const g = svgEl('g', { class: 'pm-shape', 'data-d': d.id });
      drawShape(g, d.shape, p);
      // A wider invisible copy makes thin strokes easy to click.
      drawShape(g, d.shape, p, { class: 'pm-hit' });
      const first = d.shape === 'pen' && p.points?.[0];
      const lx = first ? first[0] : d.shape === 'arrow' ? p.x1 : Math.max(p.x1, p.x2);
      const ly = first ? first[1] : d.shape === 'arrow' ? p.y1 : Math.min(p.y1, p.y2);
      g.append(svgEl('circle', { cx: lx, cy: ly, r: 10, class: 'pm-shape-badge' }));
      const t = svgEl('text', { x: lx, y: ly + 4, class: 'pm-shape-n', 'text-anchor': 'middle' });
      t.textContent = d.n;
      g.append(t);
      g.addEventListener('click', open);
      shapes.append(g);
    }
  }

  function hotDrawing(id) {
    $$('.pm-hot-d', ui?.layer || document).forEach((e) => e.classList.remove('pm-hot-d'));
    if (id) ui.layer.querySelector(`[data-d="${CSS.escape(id)}"]`)?.classList.add('pm-hot-d');
  }

  // Typing in a field, or a modifier held: the key is the reader's, not a shortcut.
  const typing = (e) => e.metaKey || e.ctrlKey || e.altKey || !!e.target.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  let setTool = () => {};

  function wireDrawing(rail) {
    const ov = ui.overlay;
    const preview = $('#pm-preview', ui.layer);
    let tool = null;
    let start = null;
    let pts = null; // the pen's stroke so far, in page coordinates
    const press = () =>
      $$('button[data-shape]', rail).forEach((b) => {
        const on = (b.dataset.shape || null) === tool;
        b.classList.toggle('pm-on', on);
        b.setAttribute('aria-pressed', String(on));
      });
    const stop = () => {
      tool = null;
      start = null;
      pts = null;
      ov.hidden = true;
      preview.textContent = '';
      document.documentElement.classList.remove('pm-drawing');
      press();
    };
    setTool = (next) => {
      if (READ_ONLY || locked || !next || next === tool) return stop(); // the tool that's on, or Select, puts the pen down
      tool = next;
      // On narrower screens the open panel covers part of the page (a bottom
      // sheet on phones): get it out of the way. It reopens once the shape is drawn.
      if (!window.matchMedia('(min-width: 1100px)').matches) setPanel(false);
      ov.hidden = false;
      layoutDrawings();
      document.documentElement.classList.add('pm-drawing');
      press();
    };
    rail.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-shape]');
      if (b) setTool(b.dataset.shape || null);
    });
    const KEYS = Object.fromEntries(TOOLS.map(([k, , key]) => [key.toLowerCase(), k === 'select' ? null : k]));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && tool) return stop();
      if (e.key === 'Escape' && document.documentElement.classList.contains('pm-focus') && !typing(e)) return setFocus(false);
      if (typing(e) || READ_ONLY) return;
      const k = e.key.toLowerCase();
      if (k === 'f') {
        e.preventDefault();
        return setFocus(!document.documentElement.classList.contains('pm-focus'));
      }
      if (k in KEYS && !locked) {
        e.preventDefault();
        setTool(KEYS[k]);
      }
    });
    press();
    ov.addEventListener('pointerdown', (e) => {
      if (!tool) return;
      e.preventDefault();
      ov.setPointerCapture?.(e.pointerId);
      start = { cx: e.clientX, cy: e.clientY, x: e.pageX, y: e.pageY };
      pts = tool === 'pen' ? [[e.pageX, e.pageY]] : null;
    });
    ov.addEventListener('pointermove', (e) => {
      if (!tool || !start || tool === 'point' || tool === 'note') return;
      if (pts) {
        const [lx, ly] = pts[pts.length - 1];
        if (Math.hypot(e.pageX - lx, e.pageY - ly) >= 3 && pts.length < 600) pts.push([e.pageX, e.pageY]);
      }
      preview.textContent = '';
      const g = svgEl('g', { class: 'pm-shape pm-preview' });
      drawShape(g, tool, { x1: start.x, y1: start.y, x2: e.pageX, y2: e.pageY, points: pts });
      preview.append(g);
    });
    ov.addEventListener('pointerup', (e) => {
      if (!tool || !start) return;
      const s = start;
      start = null;
      preview.textContent = '';
      const single = tool === 'point' || tool === 'note';
      let stroke = null;
      if (tool === 'pen') {
        stroke = [...pts, [e.pageX, e.pageY]];
        pts = null;
        const xs = stroke.map((q) => q[0]);
        const ys = stroke.map((q) => q[1]);
        if (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < 8) return; // a click: wait for a stroke
      } else if (!single && Math.hypot(e.pageX - s.x, e.pageY - s.y) < 8) return; // a click with a drag tool: wait for a real drag
      const anchor = anchorAt(s.cx, s.cy);
      const b = pageBox(anchor);
      const fx = (x) => +((x - b.x) / b.w).toFixed(4);
      const fy = (y) => +((y - b.y) / b.h).toFixed(4);
      const xs = stroke ? stroke.map((q) => q[0]) : null;
      const ys = stroke ? stroke.map((q) => q[1]) : null;
      const d = {
        id: Math.random().toString(36).slice(2, 9),
        n: nextN(),
        shape: tool,
        blockId: anchor === root ? null : anchor.dataset.id,
        where: anchor === root ? 'Page' : labelFor(anchor),
        excerpt: anchor === root ? '' : excerpt(anchor),
        // A pen stroke's box is its bounds; its line is in points.
        x1: fx(stroke ? Math.min(...xs) : s.x),
        y1: fy(stroke ? Math.min(...ys) : s.y),
        x2: fx(stroke ? Math.max(...xs) : single ? s.x : e.pageX),
        y2: fy(stroke ? Math.max(...ys) : single ? s.y : e.pageY),
        note: '',
        createdAt: now(),
      };
      if (stroke) d.points = stroke.map(([x, y]) => [fx(x), fy(y)]);
      d.kind = 'note';
      state.drawings.push(d);
      stop();
      layoutDrawings();
      setPanel(true);
      save();
      renderList();
      focusNote('d:' + d.id, true);
    });
  }

  // ---------- the floating toolbar: dock, drag, focus ----------
  const TOOLS_POS = 'plan-maker:tools';
  const phone = () => matchMedia('(max-width: 760px)').matches;
  function placeToolbar() {
    const bar = ui.rail;
    let pos = null;
    try {
      pos = JSON.parse(localStorage.getItem(TOOLS_POS) || 'null');
    } catch {}
    const docked = !pos || phone();
    document.documentElement.classList.toggle('pm-tools-docked', docked);
    bar.classList.toggle('pm-moved', !docked);
    if (docked) {
      bar.style.left = bar.style.top = '';
      return;
    }
    // Kept inside the window, whatever its size now.
    const r = bar.getBoundingClientRect();
    bar.style.left = Math.max(4, Math.min(pos.x, innerWidth - r.width - 4)) + 'px';
    bar.style.top = Math.max(4, Math.min(pos.y, innerHeight - r.height - 4)) + 'px';
  }
  function wireToolbarDrag(bar) {
    const grip = $('.pm-grip', bar);
    let from = null;
    grip.addEventListener('pointerdown', (e) => {
      if (phone() || e.button !== 0) return;
      e.preventDefault();
      const r = bar.getBoundingClientRect();
      from = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
      grip.setPointerCapture(e.pointerId);
      bar.classList.add('pm-dragging');
    });
    grip.addEventListener('pointermove', (e) => {
      if (!from) return;
      from.moved = true;
      bar.classList.add('pm-moved');
      document.documentElement.classList.remove('pm-tools-docked');
      const r = bar.getBoundingClientRect();
      bar.style.left = Math.max(4, Math.min(e.clientX - from.dx, innerWidth - r.width - 4)) + 'px';
      bar.style.top = Math.max(4, Math.min(e.clientY - from.dy, innerHeight - r.height - 4)) + 'px';
    });
    const drop = () => {
      if (!from) return;
      const moved = from.moved;
      from = null;
      bar.classList.remove('pm-dragging');
      if (!moved) return;
      try {
        localStorage.setItem(TOOLS_POS, JSON.stringify({ x: parseFloat(bar.style.left), y: parseFloat(bar.style.top) }));
      } catch {}
      layoutDrawings();
    };
    grip.addEventListener('pointerup', drop);
    grip.addEventListener('pointercancel', drop);
    grip.addEventListener('dblclick', () => {
      try {
        localStorage.removeItem(TOOLS_POS);
      } catch {}
      placeToolbar();
      layoutDrawings();
    });
    addEventListener('resize', placeToolbar);
    placeToolbar();
  }

  /** Focus: the top bar and the contents step aside, the browser goes full screen, and the toolbar carries Send and the way out. */
  function setFocus(on) {
    const html = document.documentElement;
    if (html.classList.contains('pm-focus') === on) return;
    html.classList.toggle('pm-focus', on);
    const b = $('#pm-t-focus');
    if (b) {
      b.setAttribute('aria-pressed', String(on));
      b.title = on ? 'Leave focus (F)' : 'Focus: just the page and this toolbar (F)';
      b.innerHTML = svg16(on ? ICON.unfocus : ICON.focus);
    }
    paintSend();
    try {
      if (on && !document.fullscreenElement && window.parent === window) document.documentElement.requestFullscreen?.().catch(() => {});
      if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    } catch {}
    layoutDrawings();
  }
  // Leaving the browser's full screen (Esc) leaves focus too.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) setFocus(false);
  });

  function jump(sel, hid) {
    const node = root.querySelector(sel);
    if (!node) return;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    $$('mark.pm-hl.pm-hot').forEach((m) => m.classList.remove('pm-hot'));
    if (hid) $$(`mark.pm-hl[data-h="${CSS.escape(hid)}"]`).forEach((m) => m.classList.add('pm-hot'));
  }


  // ---------- Claude as a backend: Send to Claude, the connection, the lock ----------
  // The review server turns Send into a job; a Claude Code session listening to it
  // (scripts/listen.mjs) picks the job up and writes the next version. The page hears about it
  // all on /api/stream: whether Claude is connected, the job's progress, and the page changing on disk.
  const LIVE = () => serverOk && CFG.mode === 'server' && !READ_ONLY;
  let claude = { connected: false, phase: 'idle', message: '' };
  let job = null; // the page's latest job
  let lockedOn = null; // the job id the page is locked for
  const ACTIVE_JOB = (j) => !!j && ['queued', 'offered', 'running'].includes(j.status);

  function paintSend() {
    const btn = $('#pm-send');
    if (!btn) return;
    const n = sendCount;
    const busy = ACTIVE_JOB(job);
    $('#pm-send-n').textContent = n;
    $('#pm-send-n').hidden = !n || busy;
    btn.disabled = busy || !n;
    btn.title = busy ? 'Claude has your notes' : n ? `Send your ${n === 1 ? 'note' : `${n} notes`} to Claude: it writes the next version` : 'Nothing to send yet: comment, ask or mark something first';
    const t = $('#pm-t-send');
    if (t) {
      t.hidden = !(LIVE() && document.documentElement.classList.contains('pm-focus'));
      t.disabled = btn.disabled;
      t.title = btn.title;
      $('#pm-t-send-n').textContent = n;
      $('#pm-t-send-n').hidden = btn.disabled;
    }
  }

  function paintClaude() {
    const pill = $('#pm-claude');
    if (!pill) return;
    const next = job?.next || (job ? job.version + 1 : (SHOWN || 1) + 1);
    let s;
    let text;
    let tip;
    if (job?.status === 'running') [s, text, tip] = ['working', `Writing v${next}…`, 'Claude is writing the next version from your notes.'];
    else if (job?.status === 'offered') [s, text, tip] = ['working', 'Claude has your notes', 'Claude is about to start on your notes.'];
    else if (job?.status === 'queued') [s, text, tip] = ['waiting', 'Waiting for Claude', 'Your notes are saved and waiting. A Claude Code session connected to this page picks them up, or say “process my notes” in Claude Code.'];
    else if (!claude.connected) [s, text, tip] = ['offline', 'Claude offline', 'No Claude Code session is listening to this page. Send still saves your notes for one, or say “process my notes” in Claude Code.'];
    else if (claude.phase === 'error') [s, text, tip] = ['error', 'Claude couldn’t finish', claude.message];
    else if (claude.phase === 'ready' && job?.status === 'done') [s, text, tip] = ['ready', `v${job.version} ready`, claude.message || job.summary];
    else if (claude.phase === 'working') [s, text, tip] = ['working', claude.message || 'Claude is working', claude.message];
    else [s, text, tip] = ['online', 'Claude connected', 'A Claude Code session is listening: Send to Claude and it writes the next version while you watch.'];
    pill.dataset.s = s;
    $('.pm-pill-t', pill).textContent = text;
    pill.title = tip || '';
    pill.hidden = false;
  }

  /** The strip under the top bar while Claude has the notes, and the lock itself. */
  function paintLock() {
    const on = ACTIVE_JOB(job);
    if (on !== locked) {
      locked = on;
      document.documentElement.classList.toggle('pm-locked', on);
      $$('#pm-panel textarea, textarea.pm-dnote').forEach((t) => (t.readOnly = on || READ_ONLY));
      if (on) {
        setTool(null);
        ui.pop.style.display = 'none';
      }
    }
    let strip = $('#pm-lock');
    requestAnimationFrame(layoutDrawings); // the strip moves the page down, and the marks with it
    if (!on) {
      if (strip) strip.hidden = true;
      return;
    }
    if (!strip) {
      strip = make('div', { id: 'pm-lock', class: 'pm-ui', role: 'status' }, '<span class="pm-lock-dot" aria-hidden="true"></span><span class="pm-lock-t"></span><button type="button" class="pm-lock-undo">Take them back</button>');
      $('.pm-lock-undo', strip).addEventListener('click', takeBack);
      ui.top.after(strip);
    }
    strip.hidden = false;
    const next = job.next || job.version + 1;
    strip.dataset.s = job.status;
    $('.pm-lock-t', strip).textContent =
      job.status === 'running' ? `Claude is writing v${next} from your notes. This page reloads when it’s ready.`
      : job.status === 'offered' ? 'Claude has your notes and is starting on them.'
      : claude.connected ? 'Your notes are with Claude, waiting their turn.'
      : 'Your notes are saved and waiting for Claude. Start a Claude Code session in this project (or say “process my notes” there) and it picks them up.';
    $('.pm-lock-undo', strip).hidden = job.status === 'running';
  }

  function toast(text, ms = 6000) {
    let t = $('#pm-toast');
    if (!t) {
      t = make('div', { id: 'pm-toast', class: 'pm-ui', role: 'status' });
      document.body.append(t);
    }
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.hidden = true), ms);
  }

  function onJob(j) {
    const was = job;
    job = j;
    if (ACTIVE_JOB(j)) lockedOn = j.id;
    // The job we were waiting on is over: a new version reloads in; a failure unlocks with the reason.
    if (lockedOn && j && j.id === lockedOn && !ACTIVE_JOB(j)) {
      lockedOn = null;
      if (j.status === 'done') {
        try {
          sessionStorage.setItem('plan-maker:done', JSON.stringify({ version: j.version, summary: j.summary }));
        } catch {}
        location.reload();
        return;
      }
      if (j.status === 'failed') toast(`Claude couldn’t finish: ${j.error || 'no reason given'}. Your notes are unlocked; send them again when you’re ready.`, 12000);
    }
    if (was?.status !== j?.status || was?.id !== j?.id) {
      paintLock();
      paintSend();
    }
    paintClaude();
  }

  async function send() {
    if (!LIVE() || locked || !sendCount) return;
    // Save what's typed so far first, so Claude gets the notes as they are now.
    clearTimeout(saveTimer);
    try {
      state.updatedAt = now();
      state.doneAt = now();
      state.autoIds = autoMode;
      const put = await fetch('/api/notes', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state, null, 2) + '\n' });
      if (!put.ok) throw new Error(await put.text());
      const r = await fetch('/api/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (!r.ok) throw new Error(await r.text());
      const out = await r.json();
      if (out.claude) claude = out.claude;
      onJob(out.job);
      setStatus('Sent to Claude');
    } catch (err) {
      toast('Not sent: ' + (err.message || err));
    }
  }

  async function takeBack() {
    if (!job || !ACTIVE_JOB(job)) return;
    const r = await fetch(`/api/jobs/${job.id}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!r.ok) return toast('Couldn’t take them back: ' + (await r.text()));
    lockedOn = null;
    onJob(await r.json());
    setStatus('Your notes are back: keep editing');
  }

  function wireClaude() {
    const live = LIVE();
    $('#pm-send').hidden = !live;
    $('#pm-done').hidden = live || READ_ONLY;
    $('#pm-send').addEventListener('click', send);
    $('#pm-t-send').addEventListener('click', send);
    paintSend();
    if (!live) return;
    try {
      const done = JSON.parse(sessionStorage.getItem('plan-maker:done') || 'null');
      sessionStorage.removeItem('plan-maker:done');
      if (done) toast(`v${done.version} is ready${done.summary ? `: ${done.summary}` : ''}`, 9000);
    } catch {}
    connectStream();
  }

  // The page's event stream. It closes when the page goes away (so leaving doesn't cut it mid-chunk),
  // and after an error it tries again once a few seconds later, then waits for the minute's ping to
  // find the server before trying again, instead of the browser's endless retries.
  let es = null;
  let esRetry = null;
  function connectStream() {
    if (es || !LIVE()) return;
    es = new EventSource('/api/stream');
    es.onerror = () => {
      es?.close();
      es = null;
      if (esRetry || lost) return;
      esRetry = setTimeout(() => {
        esRetry = null;
        if (!lost) connectStream();
      }, 3000);
    };
    es.onmessage = (e) => {
      let ev;
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      if (ev.type === 'bye') {
        // The server is stopping: stop listening; the minute's ping notices when it's back.
        es?.close();
        es = null;
        lost = true;
        claude = { connected: false, phase: 'idle', message: '' };
        // Replaced (a Claude session taking the page over, on the same port): look again in a
        // moment rather than at the next minute's ping.
        if (ev.replaced) for (const ms of [1500, 4000, 10000]) setTimeout(() => lost && ping(), ms);
        return paintClaude();
      }
      if (ev.claude) claude = ev.claude;
      if (ev.type === 'hello' || ev.type === 'job') onJob(ev.job || null);
      else if (ev.type === 'claude') paintClaude();
      else if (ev.type === 'page' && !locked && !lockedOn) {
        // Changed on disk outside a round (Claude editing it in conversation): offer the new copy.
        $('#pm-reload').hidden = false;
      }
    };
  }
  addEventListener('pagehide', () => {
    es?.close();
    es = null;
  });

  // ---------- boot ----------
  // An open tab tells its review server it's still there, once a minute: a server
  // no tab has spoken to for hours stops itself (review.mjs --idle-hours).
  let lost = false;
  async function ping() {
    try {
      const r = await fetch('/api/ping', { method: 'POST', cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      if (lost) setStatus(READ_ONLY ? `Read-only · v${SHOWN}` : 'Connected again');
      lost = false;
      connectStream();
    } catch {
      lost = true;
      setStatus('Not saving: the review server stopped. Open this page from the hub to start it again.');
    }
  }

  async function boot() {
    if (CFG.mode === 'server' || CFG.mode === 'snapshot') setInterval(ping, 60e3);
    if (CFG.legacy) return bootLegacy();
    buildUi();
    assignIds();
    state.autoIds = autoMode;
    await Promise.all([load(), loadLinks()]);
    wireClaude();
    wireLinks();
    decorate();
    buildRail();
    requestAnimationFrame(() => {
      const nav = document.querySelector('nav.toc.pm-rail');
      const cur = nav?.querySelector('a[data-pm-state="current"]');
      if (nav && cur && nav.scrollHeight > nav.clientHeight) nav.scrollTop = Math.max(0, cur.offsetTop - nav.clientHeight / 3);
    });
    ui.general.value = state.general || '';
    new Set([...Object.keys(state.items), ...Object.keys(state.steps || {})]).forEach(paintItem);
    $$('.decision', root).forEach(paintDecision);
    state.highlights.forEach((h) => {
      h.orphaned = !paintHighlight(h) || undefined;
    });
    markChanged();
    renderProgress();
    renderList();
    setPanel(false); // opens when the reader adds a note or presses Notes
    // Drawings follow their blocks: redraw whenever the layout can have moved.
    layoutDrawings();
    let raf = 0;
    const relayout = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(layoutDrawings);
    };
    addEventListener('resize', relayout);
    addEventListener('load', relayout);
    document.fonts?.ready.then(relayout);
    if (window.ResizeObserver) new ResizeObserver(relayout).observe(root);
    await ui.versions;
    document.documentElement.dataset.pmReady = '1';
  }

  // An earlier version that carries its own review script: leave the page as it
  // was and add only the read-only banner and the version switcher.
  async function bootLegacy() {
    document.documentElement.classList.add('pm-ro', 'pm-legacy');
    const bar = make(
      'div',
      { id: 'pm-bar', class: 'pm-ui', role: 'toolbar', 'aria-label': 'Plan versions' },
      `<span class="pm-ver" hidden><button type="button" id="pm-ver" aria-haspopup="menu" aria-expanded="false"></button><div id="pm-vmenu" role="menu" hidden></div></span><span id="pm-status">Read-only · v${SHOWN}</span>`,
    );
    document.body.prepend(banner());
    document.body.append(bar);
    await wireVersions(bar);
    document.documentElement.dataset.pmReady = '1';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

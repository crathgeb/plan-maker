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
  const SHAPES = { arrow: 'Arrow', box: 'Box', circle: 'Circle', point: 'Point', note: 'Sticky note' };
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
    if (READ_ONLY) return;
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
       <button type="button" id="pm-toggle">Comments <span id="pm-count">0</span></button>
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
      `<div class="pm-title"><span class="pm-kind" data-k="${KIND}">${KIND[0].toUpperCase() + KIND.slice(1)}</span><strong class="pm-title-name"></strong><span class="pm-status" hidden><span class="pm-status-dot" aria-hidden="true"></span><select id="pm-status-sel" aria-label="Status">${KIND_STATUSES[KIND].map((v) => `<option value="${v}">${STATUS_LABELS[v]}</option>`).join('')}<option disabled>──────────</option><option value="pm-remove">Remove from hub…</option></select><svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></span></div><span class="pm-top-sp"></span>
       <div id="pm-rail" role="toolbar" aria-label="Draw"><span class="pm-rail-lbl">Draw</span>${Object.entries(SHAPES)
         .map(([k, v]) => {
           const tip = `${v}: ${k === 'point' || k === 'note' ? 'click' : 'drag'} on the page. Esc cancels.`;
           return `<button type="button" data-shape="${k}" aria-pressed="false" aria-label="${v}" title="${tip}"><span class="pm-ico pm-ico-${k}" aria-hidden="true"></span></button>`;
         })
         .join('')}</div>`,
    );
    const rail = $('#pm-rail', top);
    // Drawings: an SVG layer for arrows, boxes and circles, HTML for points and
    // sticky notes, and a full-screen overlay that catches the pointer while drawing.
    const layer = make('div', { id: 'pm-layer', class: 'pm-ui', 'aria-hidden': 'true' });
    layer.innerHTML =
      '<svg id="pm-svg" xmlns="http://www.w3.org/2000/svg"><defs><marker id="pm-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs><g id="pm-shapes"></g><g id="pm-preview"></g></svg><div id="pm-pins"></div>';
    const overlay = make('div', { id: 'pm-overlay', class: 'pm-ui', hidden: '' });
    // Everything sits in the top bar: progress, draw tools, then save status, Notes and the main action.
    bar.classList.remove('pm-ui');
    top.append(bar);
    document.body.append(layer, overlay, panel, top, pop, dialog);
    document.documentElement.classList.add('pm-has-top');
    ui = { panel, bar, top, rail, pop, dialog, layer, overlay, list: $('#pm-list', panel), general: $('#pm-general', panel) };
    if (READ_ONLY) {
      document.documentElement.classList.add('pm-ro');
      document.body.prepend(banner());
      $('.pm-help', panel).textContent = `The comments you wrote on v${SHOWN}. This version is read-only.`;
      ui.general.readOnly = true;
      ui.general.placeholder = 'No comment on the whole plan.';
      $('#pm-done', bar).hidden = true;
      rail.hidden = true;
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
      if (isStep && who === 'claude') parts.push(`<span class="pm-status-tag" data-s="${statusOf(node)}">${STATUS[statusOf(node)]}</span>`);
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
    if (whoOf(n) === 'claude') return statusOf(n) === 'done';
    const g = n.matches('.phase') ? guideOf(n) : null;
    if (g?.exists) return !!g.done;
    return !!state.steps[n.dataset.id]?.done;
  }
  const units = () => $$(UNIT, root).filter((n) => !n.closest('.pm-ui'));

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
      // The reader's units: Mark done, or a phase's guide finished.
      if (whoOf(n) !== 'claude') n.classList.toggle('pm-step-done', isDone(n));
      if (!isDone(n) && !current) current = n;
    }
    current?.classList.add('pm-current');
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
        db.textContent = done ? 'Done' : 'Mark done';
        db.setAttribute('aria-pressed', String(done));
        db.classList.toggle('pm-on', done);
      }
      const nb = ctl.querySelector('.pm-note-btn');
      nb.classList.toggle('pm-has', open);
      nb.dataset.k = open ? it.kind || 'note' : '';
      nb.textContent = open ? { question: 'Your question', detail: 'More detail asked', guide: 'Guide requested' }[it.kind] || 'Your comment' : 'Comment';
      // With a note open, its one button says what it is; the other asks wait.
      ctl.querySelectorAll('.pm-detail-btn, .pm-guide-btn').forEach((b) => (b.hidden = open));
      ctl.classList.toggle('pm-active', open || done);
    }
    node.classList.toggle('pm-step-done', done);
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
    $('#pm-count').textContent = written.length + marks + (v.change || 0) + (v.cut || 0);
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
    return { x1: b.x + d.x1 * b.w, y1: b.y + d.y1 * b.h, x2: b.x + d.x2 * b.w, y2: b.y + d.y2 * b.h };
  }

  function drawShape(g, shape, p, attrs = {}) {
    const x = Math.min(p.x1, p.x2);
    const y = Math.min(p.y1, p.y2);
    const w = Math.abs(p.x2 - p.x1);
    const h = Math.abs(p.y2 - p.y1);
    if (shape === 'arrow') g.append(svgEl('line', { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, 'marker-end': 'url(#pm-head)', ...attrs }));
    else if (shape === 'box') g.append(svgEl('rect', { x, y, width: w, height: h, rx: 6, ...attrs }));
    else if (shape === 'circle') g.append(svgEl('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: Math.max(w / 2, 1), ry: Math.max(h / 2, 1), ...attrs }));
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
      const lx = d.shape === 'arrow' ? p.x1 : Math.max(p.x1, p.x2);
      const ly = d.shape === 'arrow' ? p.y1 : Math.min(p.y1, p.y2);
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

  function wireDrawing(rail) {
    const ov = ui.overlay;
    const preview = $('#pm-preview', ui.layer);
    let tool = null;
    let start = null;
    const press = () =>
      $$('button[data-shape]', rail).forEach((b) => {
        const on = b.dataset.shape === tool;
        b.classList.toggle('pm-on', on);
        b.setAttribute('aria-pressed', String(on));
      });
    const stop = () => {
      tool = null;
      start = null;
      ov.hidden = true;
      preview.textContent = '';
      document.documentElement.classList.remove('pm-drawing');
      press();
    };
    rail.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-shape]');
      if (!b) return;
      // Clicking the tool that's already on turns it off.
      if (tool === b.dataset.shape) return stop();
      tool = b.dataset.shape;
      // On narrower screens the open panel covers part of the page (a bottom
      // sheet on phones): get it out of the way. It reopens once the shape is drawn.
      if (!window.matchMedia('(min-width: 1100px)').matches) setPanel(false);
      ov.hidden = false;
      layoutDrawings();
      document.documentElement.classList.add('pm-drawing');
      press();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && tool) stop();
    });
    ov.addEventListener('pointerdown', (e) => {
      if (!tool) return;
      e.preventDefault();
      ov.setPointerCapture?.(e.pointerId);
      start = { cx: e.clientX, cy: e.clientY, x: e.pageX, y: e.pageY };
    });
    ov.addEventListener('pointermove', (e) => {
      if (!tool || !start || tool === 'point' || tool === 'note') return;
      preview.textContent = '';
      const g = svgEl('g', { class: 'pm-shape pm-preview' });
      drawShape(g, tool, { x1: start.x, y1: start.y, x2: e.pageX, y2: e.pageY });
      preview.append(g);
    });
    ov.addEventListener('pointerup', (e) => {
      if (!tool || !start) return;
      const s = start;
      start = null;
      preview.textContent = '';
      const single = tool === 'point' || tool === 'note';
      const dist = Math.hypot(e.pageX - s.x, e.pageY - s.y);
      if (!single && dist < 8) return; // a click with a drag tool: wait for a real drag
      const anchor = anchorAt(s.cx, s.cy);
      const b = pageBox(anchor);
      const fx = (x) => +((x - b.x) / b.w).toFixed(4);
      const fy = (y) => +((y - b.y) / b.h).toFixed(4);
      const d = {
        id: Math.random().toString(36).slice(2, 9),
        n: nextN(),
        shape: tool,
        blockId: anchor === root ? null : anchor.dataset.id,
        where: anchor === root ? 'Page' : labelFor(anchor),
        excerpt: anchor === root ? '' : excerpt(anchor),
        x1: fx(s.x),
        y1: fy(s.y),
        x2: fx(single ? s.x : e.pageX),
        y2: fy(single ? s.y : e.pageY),
        note: '',
        createdAt: now(),
      };
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

  function jump(sel, hid) {
    const node = root.querySelector(sel);
    if (!node) return;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    $$('mark.pm-hl.pm-hot').forEach((m) => m.classList.remove('pm-hot'));
    if (hid) $$(`mark.pm-hl[data-h="${CSS.escape(hid)}"]`).forEach((m) => m.classList.add('pm-hot'));
  }

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
    wireLinks();
    decorate();
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

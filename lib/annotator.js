/*
 * plan-maker annotation layer.
 *
 * Turns any HTML plan into a review surface: select text to add a note, mark
 * items Keep / Change / Cut, add notes to items and sections, answer
 * decisions, write general notes. Builds all of its own UI; the plan only
 * needs plain HTML that follows the conventions in the README.
 *
 * Injected by scripts/review.mjs (saves to notes.json through the server) or
 * inlined by scripts/bundle.mjs (saves in the browser, with a download).
 * Configuration comes from window.PLAN_MAKER = { mode, plan, notesPath, notes }.
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
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/, '') || 'block';
  const now = () => new Date().toISOString();

  const root = $('[data-plan]') || $('main') || document.body;
  const byId = (id) => root.querySelector(`[data-id="${CSS.escape(id)}"]`);
  const LS_KEY = 'plan-maker:' + (meta('plan-id') || CFG.plan);

  let state = {
    version: SCHEMA,
    plan: CFG.plan,
    planVersion: meta('plan-version'),
    title: document.title,
    updatedAt: null,
    general: '',
    items: {},
    highlights: [],
    decisions: {},
  };
  let serverOk = false;
  let saveTimer = null;
  let autoMode = false;
  const ctx = new WeakMap(); // element -> { section, heading } (nearest headings above it)
  const ctls = new Map(); // item id -> its Keep/Change/Cut bar
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
    }
    setStatus(serverOk ? 'Saving to ' + CFG.notesPath.split('/').pop() : 'Saving in this browser');
  }

  function save() {
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
        setStatus(r.ok ? 'Saved ✓ ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Save failed');
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
      { id: 'pm-panel', class: 'pm-ui', 'aria-label': 'Review notes' },
      `<div class="pm-head"><strong>Your notes</strong><button type="button" class="pm-x" aria-label="Close notes">×</button></div>
       <p class="pm-help">Select text in the plan, then <b>Add note</b>. Mark items <b>Keep / Change / Cut</b>. Everything saves as you go.</p>
       <label class="pm-lbl" for="pm-general">General notes</label>
       <textarea id="pm-general" placeholder="Anything that isn't about one spot: direction, priorities, what's missing…"></textarea>
       <div id="pm-summary"></div>
       <div id="pm-list"></div>`,
    );
    const bar = make(
      'div',
      { id: 'pm-bar', class: 'pm-ui', role: 'toolbar', 'aria-label': 'Plan review' },
      `<span id="pm-status" aria-live="polite">Loading…</span>
       <button type="button" id="pm-toggle">Notes <span id="pm-count">0</span></button>
       <button type="button" id="pm-done" class="pm-primary">Done reviewing</button>`,
    );
    const pop = make('button', { type: 'button', id: 'pm-pop', class: 'pm-ui' }, '＋ Add note');
    const dialog = make(
      'dialog',
      { id: 'pm-dialog', class: 'pm-ui' },
      `<h3>Notes saved</h3>
       <p id="pm-done-text"></p>
       <p>Go back to Claude and say <b>“process my notes”</b>. You can keep reviewing here; it keeps saving.</p>
       <div class="pm-row"><button type="button" id="pm-export">Download notes.json</button><button type="button" id="pm-close">Close</button></div>`,
    );
    const spacer = make('div', { class: 'pm-ui pm-spacer', 'aria-hidden': 'true' });
    document.body.append(spacer, panel, bar, pop, dialog);
    ui = { panel, bar, pop, dialog, list: $('#pm-list', panel), general: $('#pm-general', panel) };

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
        t.textContent = 'Your notes are in ';
        t.append(make('code', {}, ''), '.');
        t.querySelector('code').textContent = CFG.notesPath;
      } else {
        t.innerHTML = 'The review server isn’t running, so your notes are only in this browser. Click <b>Download notes.json</b> and put the file next to the plan.';
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
    wireSelection(pop);
  }

  const setStatus = (s) => {
    const el = $('#pm-status');
    if (el) el.textContent = s;
  };
  function setPanel(open) {
    document.documentElement.classList.toggle('pm-open', open);
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
    pop.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      addHighlight();
    });
    pop.addEventListener('mousedown', (e) => e.preventDefault());
    pop.addEventListener('click', addHighlight);
    function addHighlight() {
      if (!pending) return;
      const p = pending;
      pending = null;
      const block = byId(p.blockId);
      const h = {
        id: Math.random().toString(36).slice(2, 9),
        n: state.highlights.reduce((m, x) => Math.max(m, x.n || 0), 0) + 1,
        blockId: p.blockId,
        where: labelFor(block),
        quote: p.quote,
        start: p.start,
        end: p.end,
        note: '',
        createdAt: now(),
      };
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
    const it = state.items[id] || (state.items[id] = { where: '', verdict: null, note: '' });
    it.where = labelFor(node);
    it.excerpt = excerpt(node);
    return it;
  }

  function openItemNote(id) {
    const it = ensureItem(id);
    it.noteOpen = true;
    paintItem(id);
    setPanel(true);
    save();
    renderList();
    focusNote('i:' + id, true);
  }

  function decorate() {
    $$('.item[data-id]', root).forEach((node) => {
      if (node.closest('.pm-ui')) return;
      const id = node.dataset.id;
      node.classList.add('pm-item');
      const ctl = make(
        'div',
        { class: 'pm-ui pm-ctl', role: 'group', 'aria-label': 'Verdict' },
        `<button type="button" class="pm-v" data-v="keep" aria-pressed="false">Keep</button><button type="button" class="pm-v" data-v="change" aria-pressed="false">Change</button><button type="button" class="pm-v" data-v="cut" aria-pressed="false">Cut</button><span class="pm-sp"></span><button type="button" class="pm-note-btn" aria-label="Note on this item"></button>`,
      );
      if (node.tagName === 'TR') (node.lastElementChild || node).appendChild(ctl);
      else if (node.matches('table, pre')) {
        (node.closest('.table-wrap') || node).after(ctl);
        ctl.dataset.for = id;
      } else node.appendChild(ctl);
      ctl.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.classList.contains('pm-note-btn')) return openItemNote(id);
        const it = ensureItem(id);
        it.verdict = it.verdict === b.dataset.v ? null : b.dataset.v;
        paintItem(id);
        save();
        renderList();
      });
      ctls.set(id, ctl);
    });

    let secs = $$('section[data-id]', root).filter((s) => !s.closest('.pm-ui'));
    if (!secs.length && autoMode) secs = $$('h2[data-id]', root);
    secs.forEach((sec) => {
      const id = sec.dataset.id;
      const b = make('button', { type: 'button', class: 'pm-ui pm-sec-note', 'aria-label': 'Note on this section' });
      b.addEventListener('click', () => openItemNote(id));
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
      const ta = make('textarea', { class: 'pm-ui pm-dnote', rows: '2', placeholder: 'Optional note on this decision…' });
      d.append(ta);
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

  function paintItem(id) {
    const it = state.items[id];
    const node = byId(id);
    if (!node) return;
    const open = !!(it && (it.note || it.noteOpen));
    const ctl = ctls.get(id);
    if (ctl) {
      ctl.querySelectorAll('.pm-v').forEach((b) => {
        const on = it?.verdict === b.dataset.v;
        b.classList.toggle('pm-on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      ctl.querySelector('.pm-note-btn').classList.toggle('pm-has', open);
      ctl.classList.toggle('pm-active', !!it?.verdict || open);
    }
    node.classList.toggle('pm-cut', it?.verdict === 'cut');
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

  function renderSummary() {
    const v = Object.values(state.items).reduce((a, it) => {
      if (it.verdict) a[it.verdict] = (a[it.verdict] || 0) + 1;
      return a;
    }, {});
    const notes =
      state.highlights.filter((h) => h.note).length + Object.values(state.items).filter((it) => it.note).length;
    const decided = Object.values(state.decisions).filter((d) => d.choice).length;
    const total = $$('.decision', root).length;
    const parts = [`${notes} note${notes === 1 ? '' : 's'}`, `${v.keep || 0} keep`, `${v.change || 0} change`, `${v.cut || 0} cut`];
    if (total) parts.push(`${decided}/${total} decisions`);
    $('#pm-summary').textContent = parts.join(' · ');
    $('#pm-count').textContent = notes + (v.change || 0) + (v.cut || 0);
  }

  function renderList() {
    const entries = [];
    state.highlights.forEach((h) => entries.push({ key: 'h:' + h.id, order: docOrder(h.blockId) + (h.start || 0) / 1e6, h }));
    Object.entries(state.items).forEach(([id, it]) => {
      if (it.note || it.noteOpen) entries.push({ key: 'i:' + id, order: docOrder(id), id, it });
    });
    entries.sort((a, b) => a.order - b.order);
    const list = ui.list;
    list.innerHTML = '';
    if (!entries.length) {
      list.innerHTML = '<p class="pm-empty">No notes yet. Select text in the plan, or use ＋ note on any item.</p>';
    }
    for (const e of entries) {
      const box = make('div', { class: 'pm-note', 'data-key': e.key });
      box.innerHTML = `<div class="pm-nh"><span class="pm-num"></span><button type="button" class="pm-where"></button><button type="button" class="pm-del">Delete</button></div>`;
      const where = $('.pm-where', box);
      const ta = make('textarea');
      if (e.h) {
        $('.pm-num', box).textContent = e.h.n;
        where.textContent = e.h.where + (e.h.orphaned ? ' (text no longer found)' : '');
        const q = make('blockquote');
        q.textContent = e.h.quote;
        box.append(q);
        ta.placeholder = 'Your note on the highlighted text…';
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
        $('.pm-num', box).textContent = '●';
        where.textContent = (e.it.where || e.id) + (e.it.verdict ? ' · ' + e.it.verdict.toUpperCase() : '');
        ta.placeholder = 'Your note…';
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
          paintItem(e.id);
          save();
          renderList();
        });
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
  }

  function jump(sel, hid) {
    const node = root.querySelector(sel);
    if (!node) return;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    $$('mark.pm-hl.pm-hot').forEach((m) => m.classList.remove('pm-hot'));
    if (hid) $$(`mark.pm-hl[data-h="${CSS.escape(hid)}"]`).forEach((m) => m.classList.add('pm-hot'));
  }

  // ---------- boot ----------
  async function boot() {
    buildUi();
    assignIds();
    state.autoIds = autoMode;
    await load();
    decorate();
    ui.general.value = state.general || '';
    Object.keys(state.items).forEach(paintItem);
    $$('.decision', root).forEach(paintDecision);
    state.highlights.forEach((h) => {
      h.orphaned = !paintHighlight(h) || undefined;
    });
    renderList();
    setPanel(window.matchMedia('(min-width: 1100px)').matches);
    document.documentElement.dataset.pmReady = '1';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

# Changelog

## Unreleased

- **guide-me**: step-by-step guides you follow rather than review. New skills `guide-me` and `regenerate-guide`, command `/plan-maker:guide`, template `templates/guide.html`. `<meta name="pm-kind" content="guide">` turns on guide mode:
  - **Mark done** on steps, with a progress bar in a bar fixed to the top of the page, beside the draw tools.
  - **? Ask** on steps and items, and **? Ask / ＋ Note** on selected text; every note is a question or a note.
  - A **Copy** button on every code block.
  - No Keep / Change / Cut.
  - `regenerate-guide` answers each question in place (`aside.explain`), and `snapshot.mjs` carries the done steps into the next version's `notes.json`.
- **Drawing**, in plans and guides: Draw tools, always on screen in a bar at the top of the page, add arrows, boxes, circles, points and sticky notes anywhere on the page in one click. They're anchored to the block under them, saved in `notes.json` as `drawings[]`, shown in the notes panel and numbered with the highlights. `process-plan-notes` reads them.
- The toolbar is now a bar fixed to the top of the page: a guide's progress, the draw tools, the save status, **Notes** and the main action. On phones it takes two rows. The floating bar at the bottom is gone.

- `review.mjs --host <address>` (or `PLAN_MAKER_HOST`) to review from another device: `0.0.0.0` for every interface, or one address such as a VPN's. Beyond loopback, every request needs a per-run key, printed in each `net →` URL and kept in a cookie after the first visit. Loopback stays the default and works as before.
- `--trust tailnet,<CIDR>` (or `PLAN_MAKER_TRUST`): devices on those networks need no key, provided they address the server by IP, `*.ts.net` or this machine's hostname, so DNS rebinding stays blocked.
- `/api/health` names the plan by a hash instead of its path, because it now answers without a key.

## 0.2.0 (2026-11-07)

Versions: every plan you review is kept.

- `scripts/snapshot.mjs` saves the live plan as `versions/v<N>.html` and moves its notes to `versions/v<N>.notes.json` before a revision. It never overwrites a snapshot. `process-plan-notes` runs it before editing anything.
- Version switcher in the toolbar (**v2 ▾**), listing every version with its date and a summary of its notes. Older versions open read-only at `/versions/v<N>`, with a banner, their notes shown and the controls disabled. New route: `GET /api/versions`.
- "What changed in vN" (`section#changes`) is a standard part of every revision (`templates/changes-section.html`), and `data-changed="vN"` shows a "changed in vN" badge.
- The server refuses saves from an old version's page or a tab still showing an older version, so notes can't land on the wrong version.
- Older pages that carry their own review script are shown as they were, with their notes, and can't save.
- `bundle.mjs --all-versions` writes every version, linked by the switcher.
- `<meta name="plan-date">` in the template. Notes archived as `notes-v<N>.json` by 0.1 are still read.

## 0.1.0 (2026-11-07)

First release.

- Annotation layer (`lib/annotator.js`, `lib/annotator.css`): notes on selected text, Keep / Change / Cut on items, item and section notes, pick-one decisions, general notes, a notes panel that becomes a bottom sheet on phones, light and dark themes.
- Stable ids assigned from headings for plain HTML with no `data-id`s.
- Review server (`scripts/review.mjs`): injects the layer, saves `notes.json` beside the plan, binds to 127.0.0.1, finds a free port, reuses a server already serving the same plan.
- Bundle command (`scripts/bundle.mjs`): a self-contained HTML copy that saves in the browser and downloads `notes.json`.
- Neutral plan template (`templates/plan.html`).
- Skills: `make-plan`, `review-plan`, `process-plan-notes`; command `/plan-maker:plan`.

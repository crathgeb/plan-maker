# Changelog

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

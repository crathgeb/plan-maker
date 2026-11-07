# Changelog

## 0.1.0 (2026-11-07)

First release.

- Annotation layer (`lib/annotator.js`, `lib/annotator.css`): notes on selected text, Keep / Change / Cut on items, item and section notes, pick-one decisions, general notes, a notes panel that becomes a bottom sheet on phones, light and dark themes.
- Stable ids assigned from headings for plain HTML with no `data-id`s.
- Review server (`scripts/review.mjs`): injects the layer, saves `notes.json` beside the plan, binds to 127.0.0.1, finds a free port, reuses a server already serving the same plan.
- Bundle command (`scripts/bundle.mjs`): a self-contained HTML copy that saves in the browser and downloads `notes.json`.
- Neutral plan template (`templates/plan.html`).
- Skills: `make-plan`, `review-plan`, `process-plan-notes`; command `/plan-maker:plan`.

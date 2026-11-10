# Changelog

## Unreleased

- **Plans, guides and references: three kinds of page on one engine.** A page says which it is with `<meta name="pm-kind" content="plan|guide|reference">`; a page without one is a plan. All three are reviewed, versioned and listed the same way, in the same design.
  - **Plans** break an idea into **phases** (`.phase[data-who]` in `<div class="phases">`), each owned by you, Claude or both, with an outcome ("Done when…"). Claude's phases can carry a short checklist (`ul.tasks`). Your phases get **Mark done**.
  - **Make a guide** on any phase asks Claude for a guide in the next round (`kind: "guide"` in `notes.json`). A phase linked to a guide (`data-guide`) shows the guide's name and progress, opens it, and is done when the guide is. Guides made from a plan live in its folder (`plans/<plan>/guides/<slug>/`) and link back (`pm-parent`, `pm-parent-phase`): "Part of <plan> › <phase>" above the title.
  - **Guides** are your steps to follow: what you need first, "You should see" and "If it fails" in the step, **Copy** on everything. **Mark done** brings the next step into view. `/plan-maker:guide` uses the new `make-guide` skill and `templates/guide.html`.
  - **References** explain a system: contents on the cover, definitions, signatures, no progress. `pm-source` names the files a reference describes; when one changes after it, the page and the hub say it's out of date. New `make-reference` skill, `/plan-maker:reference` and `templates/reference.html`.
  - **More detail** on any block or selected text, beside Comment and Ask Claude (`kind: "detail"`).
  - **Statuses by kind**: plans as before; guides `not-started` instead of `approved`; references `draft`, `reviewing`, `current`, `archived`. A status another kind uses is refused.
  - `process-plan-notes` is now **`process-notes`**: the same loop for every kind, plus expanding what you asked More detail on, writing the guides you requested and refreshing stale references.
  - Your steps and Claude's: steps carry an owner, `data-who="you|claude|both"`. Yours get **Mark done**; Claude's show the status Claude sets (`data-status="todo|doing|done"`). The top bar shows both lanes. **Comments replace Keep / Change / Cut.** Old notes with verdicts still load and are still processed.
  - Pages from 0.2 with `<meta name="pm-kind" content="guide">` are guides again, and their `.who` tags and old notes still work. Plans written with step cards and no `pm-kind` (this release's development format) still work as plans.
- **New design** (DESIGN.md, PRODUCT.md): a calm, rounded page in the manner of Google Docs, in the system sans at 16px.
  - Every step is its own card: **blue for you**, **gold for Claude**, with an owner chip and icon. The same two colours run through the top-bar lanes and the hub.
  - Code blocks are dark, with a header showing their label (`<pre data-label="Terminal">`) and **Copy**.
  - No section or gutter numbers. The comment panel starts closed. "Updated in vN" chips mark revised blocks.
  - **Breaking for page styling:** the layer's tokens are now `--pm-you`, `--pm-claude`, `--pm-paper`, `--pm-ink` and friends. The old `--pm-accent` and `--pm-bg` are still honoured.
- **Registry and hub**: every plan, guide and reference across all projects in one list (`~/.plan-maker/registry.json`, or `$PLAN_MAKER_HOME`). The hub nests a plan's guides under it, marks each page's kind, and filters by kind; `registry.mjs list --kind`.
  - `scripts/registry.mjs`: `add`, `update`, `list`, `show`, `remove`, `scan` and `prune`. Each entry has a name, goal, description, status (draft, reviewing, approved, in-progress, blocked, done, archived), next action and a dated progress log. Live facts are read from the page and `notes.json`: each owner's steps done, open decisions, unprocessed notes and why it's waiting on you.
  - `scripts/hub.mjs` (`lib/hub.html`): projects in a sidebar with their plans nested beneath, waiting-on-you first. Everything waiting on you is the opening view; a selected plan shows its lanes, status (editable), next action and log. **Open** starts or reuses the plan's review server. It listens only on this machine, port 4477.
  - New skill `plan-registry` and command `/plan-maker:plans`. The other skills register plans and log each version.
- **Drawing**: draw tools, always in the top bar, add arrows, boxes, circles, points and sticky notes anywhere on the page. They're anchored to the block under them, saved in `notes.json` as `drawings[]` and read by `process-plan-notes`.
- The toolbar is now a bar fixed to the top of the page; on phones it takes two rows.

- The review server reports a page's kind and statuses (`/api/status`), its links (`/api/links`), and opens a linked page on its own server (`/api/open`). After 20 busy ports it takes any free one.
- `bundle.mjs` bundles a plan's guides with it, linked both ways (`--no-guides` to skip), and creates the output folder.
- - `review.mjs --host <address>` (or `PLAN_MAKER_HOST`) to review from another device: `0.0.0.0` for every interface, or one address such as a VPN's. Beyond loopback, every request needs a per-run key, printed in each `net →` URL and kept in a cookie after the first visit. Loopback stays the default and works as before.
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

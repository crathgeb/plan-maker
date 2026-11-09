# Changelog

## Unreleased

- **One kind of page, with your steps and Claude's.** Plans and guides are now one thing, a plan.
  - Steps carry an owner, `data-who="you|claude|both"`. Your steps get **Mark done**; Claude's show the status Claude sets (`data-status="todo|doing|done"`).
  - The top bar shows both lanes, **You 2/6** and **Claude 7/9**.
  - **Comments replace Keep / Change / Cut.** Select text to **Comment** or **Ask Claude**, or use the one **Comment** button on any block or section; a comment can be switched to a question. Old notes with verdicts still load and are still processed.
  - `process-plan-notes` applies your notes, answers your questions in place (`aside.explain`), keeps your ticked steps (`snapshot.mjs` carries them into the next version) and updates Claude's step statuses.
  - `guide-me`, `regenerate-guide` and `templates/guide.html` are gone. `/plan-maker:guide` now writes a plan made mostly of your steps.
  - Pages from 0.2 with `<meta name="pm-kind" content="guide">` and `.who` tags still work, and their old notes load.
- **New design** (DESIGN.md, PRODUCT.md): a calm, rounded page in the manner of Google Docs, in the system sans at 16px.
  - Every step is its own card: **blue for you**, **gold for Claude**, with an owner chip and icon. The same two colours run through the top-bar lanes and the hub.
  - Code blocks are dark, with a header showing their label (`<pre data-label="Terminal">`) and **Copy**.
  - No section or gutter numbers. The comment panel starts closed. "Updated in vN" chips mark revised blocks.
  - **Breaking for page styling:** the layer's tokens are now `--pm-you`, `--pm-claude`, `--pm-paper`, `--pm-ink` and friends. The old `--pm-accent` and `--pm-bg` are still honoured.
- **Plan registry and hub**: every plan across all projects in one list (`~/.plan-maker/registry.json`, or `$PLAN_MAKER_HOME`).
  - `scripts/registry.mjs`: `add`, `update`, `list`, `show`, `remove`, `scan` and `prune`. Each entry has a name, goal, description, status (draft, reviewing, approved, in-progress, blocked, done, archived), next action and a dated progress log. Live facts are read from the page and `notes.json`: each owner's steps done, open decisions, unprocessed notes and why it's waiting on you.
  - `scripts/hub.mjs` (`lib/hub.html`): projects in a sidebar with their plans nested beneath, waiting-on-you first. Everything waiting on you is the opening view; a selected plan shows its lanes, status (editable), next action and log. **Open** starts or reuses the plan's review server. It listens only on this machine, port 4477.
  - New skill `plan-registry` and command `/plan-maker:plans`. The other skills register plans and log each version.
- **Drawing**: draw tools, always in the top bar, add arrows, boxes, circles, points and sticky notes anywhere on the page. They're anchored to the block under them, saved in `notes.json` as `drawings[]` and read by `process-plan-notes`.
- The toolbar is now a bar fixed to the top of the page; on phones it takes two rows.

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

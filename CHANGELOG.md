# Changelog

## 1.2.0 (2026-11-20)

Do it for me: Claude does a guide's section for you, in your own Chrome.

**Upgrading:** update the plugin, then restart the pages' review servers ("launch my plans", or serve the page again; they're taken over on the same port) and reload any open tab. Existing guides need no changes: the button is added when the page is served.

- **Do it for me, on a guide's sections.** Each section with steps has a gold **Do it for me** button at its top right. It opens a Terminal window with a new Claude Code session (`claude --chrome --remote-control …`) that does the section's steps in your own Chrome, checks each one, and ticks it off on the page as it goes (the step reads **Done by Claude**, live). Logins, passwords, purchases and anything irreversible come back to you in that window. The button shows only on macOS with Claude Code and Claude in Chrome installed, on the computer serving the page; `PLAN_MAKER_DOIT=on|off` overrides. After the command center's Do it for me.
- New `scripts/step.mjs <page> done|undo <step> | show`, for a session to tick a guide's steps off; through the review server when one runs (`POST /api/steps/<id>`, a `steps` event to the tabs), on notes.json when not.
- New `GET /api/doit` and `POST /api/doit { section }`; the prompts are `prompts/doit.md` and `prompts/doit-rules.md`.

## 1.1.0 (2026-11-16)

Run it: tell Claude when it's time to do its part of a plan.

**Upgrading:** update the plugin and start a new Claude Code session, so it knows what to do with a run job. Then serve or launch your pages again (they're taken over on the same port) and reload any open tab once to get the button.

- **Run it, on Claude's steps and phases.** A Claude step or phase that isn't done has a gold **Run it** button. Press it to tell the Claude Code session serving the page that it's time to do its part. The session hears it over the same connection as Send to Claude. It marks the step in progress, does the work in this session (so you can follow along and answer questions), marks it done, and the page reloads with a line on what it did. While it waits for Claude, the button reads **Waiting for Claude · Cancel**; while Claude works, **Claude is on it…**. A run doesn't lock the page: keep commenting while Claude works. A page runs one job at a time, so Send and the other Run it buttons wait until it's done. New `POST /api/run { step }`, and a `run` kind of job with its own context pack.
- Tests no longer pick ports Chrome refuses to open (5060, 5061…), the cause of an occasional failure.

## 1.0.0 (2026-11-14)

Claude as a backend: **Send to Claude** on any page hands your notes to the Claude Code session you're working in, which writes the next version in the background while the page follows along. Each session runs the servers for the pages it works, and "launch my plans" brings up a whole repo's pages at once, with finished ones cleaned off the hub. And a new toolbar: the drawing tools float beside the page, one key each, with a pen.

**Upgrading:** update the plugin and start a new Claude Code session. Review servers already running are an older build: the first session to serve or launch a page replaces them on the same port. Reload any tab opened before the update once, to get the new toolbar and the Claude pill.

- **Send to Claude replaces Done for now.** The page saves your notes and its review server turns them into a job; the session listening to the page (`scripts/listen.mjs`, under Claude Code's Monitor tool) starts a background subagent on it with a self-contained context pack; the page reloads into the new version with a line on what changed. Notes sent while no session listens wait on disk for the next one, and "process my notes" in a session picks up a waiting job too. The pattern, its API and its limits are in `docs/claude-backend.md`, after design-driven-development's "Claude as a backend".
- **Claude, online or offline, on every page.** The top bar's pill says whether a session is listening, and what it's doing: waiting, writing v3, ready, or that it couldn't finish.
- **The page locks while Claude has your notes,** with a strip saying where it's up to, so the notes can't change under Claude or land on the wrong version (the server refuses saves while a job is active). **Take them back** before Claude starts to keep editing.
- **Each session runs its own server.** The skills start the page's server as a background task of the session that works its notes, and listen to it, so the server and the Claude listening to it end together. `review.mjs --replace` takes a page over from the hub, a link or another session on the same port (open tabs reconnect within seconds); a server from an older build is replaced without it, and a listener that reaches one says how to replace it. `listen.mjs --project` listens to every page in a project, for one session that takes everything.
- **"Launch my plans", "launch my docs".** A new `launch-pages` skill and `scripts/launch.mjs` bring up a repo's pages from one session. The launcher registers every page in the project that isn't on the hub yet and takes finished ones off it: done or archived, every phase and step done, or a guide whose plan is finished. It then serves the rest (`plans`: plans and their guides; `docs`: references and standalone guides) as its own children, with `--replace`. One `listen.mjs --project` connects them all. The servers stop with the session, even if the launcher is killed outright. `--dry-run` shows what it would do.
- **Pages taken off the hub stay off.** Removing a page from the hub, or a launch cleaning up a finished one, is remembered, so `registry.mjs scan` doesn't register it again. `registry.mjs add` brings one back.
- **`job.mjs`** for the session: `start`, `done --summary`, `fail --error`, `list` and `pack`, through the server when it runs, on the files when it doesn't.
- **The page notices when its file changes** outside a round (Claude editing it in conversation) and offers **Page updated · Reload**.
- **A floating toolbar.** The drawing tools moved out of the top bar into a strip docked at the left edge: Select (V), Point (P), Box (B), Circle (C), Arrow (A), Pen (D), Sticky note (N), then Comments with its count and Focus (F). Drag it anywhere by its grip and it stays there; double-click the grip to dock it. On phones it lies along the bottom, and the top bar is one row again.
- **Pen.** Freehand strokes, anchored to the block they start on like every other mark (`shape: "pen"`, its line in `points`, fractions of the block's box). `process-notes` reads them.
- **Focus (F):** just the page and the toolbar, full screen, with Send to Claude on the toolbar.
- **Skills:** new `launch-pages` (and `/plan-maker:launch`); `review-plan` starts the server in the session and connects it (steps 2 and 3); `make-plan`, `make-guide` and `make-reference` connect after starting the server; `process-notes` works job lines (its new step 0) and claims a waiting job when asked in conversation.
- **Server:** new `POST /api/send`, `GET /api/jobs`, `POST /api/jobs/<id>/start|done|fail|cancel`, `GET /api/claude/events`, `POST /api/claude/state` and `GET /api/stream`. `/api/health` from this machine says whether Claude is connected. Event streams end with a `bye` when the server stops. Jobs live in `~/.plan-maker/jobs/`, never in the repo.
- notes.json only grows: older notes and pages work unchanged, and a bundled copy keeps **Done for now** and **Download notes.json**.

## 0.3.0 (2026-11-14)

Three kinds of page, one hub, and pages that show you where you are: plans, guides and references on one engine; a hub across every project; plans split into Information, Steps, Questions and a Decision log; a contents rail that ticks off every step; finished work that folds away; and writing rules every page is checked against.

- **Finished work folds away.** A section whose steps are all done folds to its heading and one line ("All 4 steps done · Show"); a finished group of steps or a finished phase folds the same way; the rail folds each group's done steps into one row. One click opens any of them.
- **The contents rail scrolls on its own** (it used to scroll only with the page, so a long rail's end was out of reach), and opens at the next step.
- **Mark Claude's work done yourself.** A Claude step or phase that isn't done has its own **Mark done**: progress, the rail, Next step and the hub all count it, and `process-notes` writes it into the page.
- **The rail shows where you are.** Under a plan's Steps, every phase is listed with a ring, a half ring, or a check once it's done; the next one is in bold. A guide's rail works the same way: each section is a heading with its steps listed beneath, ticked off as you go. The rail's part headings have no icons.
- **Questions only when something is open, and a Decision log.** A plan leaves out Questions when nothing's open, and gains a Decision log part: every settled question (what was decided, and when) and the project's ADRs. `process-notes` moves each answered decision there; `check.mjs` warns about an empty Questions part, or decisions made with no log.
- **The hub's projects read as groups,** with more space around an open one and little between collapsed ones. **Pin** the projects you're working on: they move to the top, with a wider gap before the rest.
- **A calmer hub sidebar.** Each page is a two-line row: its kind icon and name, then what it wants from you ("Your turn: Make a folder to work in") or its status. A blue dot marks what's waiting on you; the per-row and per-project counts are gone, and every icon and dot lines up in one column, guides included.
- **A cleaner guide cover.** Progress and Next step share one outlined panel; What you need is a plain list under a hairline, with one optional **Good to know** line; the cover has no tinted boxes. `check.mjs` warns about a box on the cover.
- **Next step, from the top.** On plans and guides, under the progress bar: the next step (or phase) to do, its owner and its title. Press it to jump there; the step rings once and its Mark done gets focus.
- **A plan comes in parts: Information, Steps, Questions and a Decision log.** Explanation, risks included, sits in Information; Steps holds only the phases, numbered 1, 2, 3; Questions holds the open decisions; the log holds what's settled. Each part opens with a heading on the desk, and the contents rail groups the sections under the parts instead of one "Contents" list. `make-plan` writes plans this way, `process-notes` splits older plans the next time it revises them, and `check.mjs` warns about a plan without parts or with content, phases or decisions in the wrong one. Rules in `WRITING.md`, "A plan's parts".
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
  - Numbers only where there's an order: a badge on each section, and the steps' and phases' timeline. Content is never numbered. The comment panel starts closed. "Updated in vN" chips mark revised blocks.
  - **Breaking for page styling:** the layer's tokens are now `--pm-you`, `--pm-claude`, `--pm-paper`, `--pm-ink` and friends. The old `--pm-accent` and `--pm-bg` are still honoured.
- **Registry and hub**: every plan, guide and reference across all projects in one list (`~/.plan-maker/registry.json`, or `$PLAN_MAKER_HOME`). The hub nests a plan's guides under it, marks each page's kind, and filters by kind; `registry.mjs list --kind`.
  - `scripts/registry.mjs`: `add`, `update`, `list`, `show`, `remove`, `scan` and `prune`. Each entry has a name, goal, description, status (draft, reviewing, approved, in-progress, blocked, done, archived), next action and a dated progress log. Live facts are read from the page and `notes.json`: each owner's steps done, open decisions, unprocessed notes and why it's waiting on you.
  - `scripts/hub.mjs` (`lib/hub.html`): projects in a sidebar with their plans nested beneath, waiting-on-you first. Everything waiting on you is the opening view; a selected plan shows its lanes, status (editable), next action and log. **Open** starts or reuses the plan's review server. It listens only on this machine, port 4477.
  - New skill `plan-registry` and command `/plan-maker:plans`. The other skills register plans and log each version.
- **Drawing**: draw tools, always in the top bar, add arrows, boxes, circles, points and sticky notes anywhere on the page. They're anchored to the block under them, saved in `notes.json` as `drawings[]` and read by `process-plan-notes`.
- The toolbar is now a bar fixed to the top of the page; on phones it takes two rows.

- **Content and steps look different.** Only steps and phases are numbered on the timeline; entries, lists, callouts, decisions and tables sit flush with no numbers, on every kind of page, so explanation no longer reads as part of the sequence. New `WRITING.md` holds the writing rules every page follows (content versus steps, ledes, concise content: the point in the heading, two sentences a block), read by all the writing skills and `process-notes`.
- **Every section opens with a one-sentence summary** (`<p class="lede">` after its `<h2>`) saying what it covers and why it's there, in all three templates and their writing skills. In a plan, a section that describes what gets built says so and names the phase that builds it, so design is never mistaken for steps.
- **`scripts/check.mjs`** checks a page after it's written: one `<body>`, one contents list, every tag closed, unique `data-id`s, contents links that land, none of the template's example left in, and the `WRITING.md` rules it can test. The writing skills and `process-notes` run it and fix every error before handing over.
- **Remove from hub**: at the bottom of every page's status menu, and on the hub's view of a page that was deleted or moved. It drops the registry entry only (`DELETE /api/status` on the review server, `DELETE /api/entries/<id>` on the hub); the page, notes and versions stay.
- **Copy works inside the hub**: the hub's page frame may write to the clipboard, and Copy falls back to the copy command where the clipboard API is refused.
- **Running servers in the hub**: every review server on this machine, by page, with whether a tab has it open. Orphans (page deleted or moved, a duplicate server) are flagged; **Stop** one, the orphans, the ones not in use, or servers from older versions. Each server keeps a record in `~/.plan-maker/servers/` (`lib/servers.mjs`), so it's found on any port, and a second start reuses it there too.
- **Idle stop**: an open tab pings its server once a minute; a server with no tab for `--idle-hours` (or `PLAN_MAKER_IDLE_HOURS`; default 12, `0` never) stops itself. Sleep doesn't count. The page says when its server has stopped.
- The registry tests no longer leave a review server running after each run.
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

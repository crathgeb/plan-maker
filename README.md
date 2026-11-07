# plan-maker

A Claude Code plugin that turns plans into HTML pages you review in the browser.

Ask Claude for a plan and it writes a page instead of a wall of chat. You read it like a document and mark it up as you go:

- **select any text → Add note**
- mark each card, step or table row **Keep / Change / Cut**
- add a note to any item or section
- answer the pick-one **decisions** (Claude marks its recommendation)
- write general notes

A tiny local server saves everything to `notes.json` beside the plan as you type. When you're done, say **"process my notes"** and Claude revises the plan: cuts what you cut, edits what you flagged, keeps what you kept, settles your decisions, bumps the version and archives your notes.

![A plan mid-review: highlighted text with a numbered note, Keep / Change / Cut on each card, and the notes panel](docs/screenshot.png)

It works for any plan in any project. Plain HTML works too: a page without the conventions below gets stable ids from its headings, so even Markdown converted to HTML can be annotated.

## Install

In Claude Code:

```
/plugin marketplace add crathgeb/plan-maker
/plugin install plan-maker@plan-maker
```

Requires Node 18 or later. The server has no dependencies.

## Use

Just ask for a plan ("plan the migration to the new billing provider", "write up a proposal for…"). Or use the command:

```
/plan-maker:plan migrate the docs site to a static generator
```

| Skill | When it runs | What it does |
|---|---|---|
| `make-plan` | You ask for a plan, proposal or strategy, or Claude is about to present a big one | Writes the plan to `plans/<slug>/index.html` (or a path you name) from the template, starts the review server and gives you the URL |
| `review-plan` | You want to reopen a plan, or share one for offline review | Starts the server for an existing plan, or reuses the one already running |
| `process-plan-notes` | You say "process my notes" or "I've reviewed the plan" | Maps every note and verdict to its element, shows a short table of changes, revises the plan, bumps its version, archives `notes.json` as `notes-v<N>.json` and lists what still needs your call |

### Without Claude

The scripts work on their own:

```bash
# Review any HTML file. Notes go to notes.json beside it.
node scripts/review.mjs path/to/plan.html [--port 4478] [--no-open]

# Write a self-contained copy for sharing or opening from disk.
node scripts/bundle.mjs path/to/plan.html [-o out.html] [--with-notes]
```

The server binds to 127.0.0.1 only. If port 4478 is taken it uses the next free one. If a server is already serving the same plan, it prints that URL and exits. It reads the plan fresh on every load, so a reload shows Claude's edits.

The bundled copy has the annotation layer inlined. Opened from disk, it saves in the browser and offers **Download notes.json**; put that file beside the plan. Images the plan links to are not inlined.

## How it works

`lib/annotator.js` and `lib/annotator.css` are the whole review layer. The script builds its own notes panel, selection popover, toolbar and dialog, so a plan is plain HTML with no script of its own. The server injects the layer before `</body>` on every request; the bundle command inlines it once. All the layer's classes start with `pm-`, so it sits on top of any page's styles.

Highlights are stored as character offsets within a block, counting only the plan's own text (never the layer's buttons), plus the quoted text. When the plan changes, a highlight is found again by its quote in the same block, then anywhere in the plan.

## HTML conventions

`templates/plan.html` shows each of these in use, with a neutral light and dark theme and a phone layout.

| Mark | Effect |
|---|---|
| `data-id="…"` | Makes a block annotatable. Selected text is attributed to the nearest block with a `data-id`. Use unique, stable, kebab-case ids. |
| `class="item"` | Adds **Keep / Change / Cut** and **＋ note**: cards, phases, steps, table rows (`<tr>`), whole tables, code blocks. |
| `<section data-id>` | Adds a section note after the section's heading. |
| `<div class="decision" data-decision="key">` | A pick-one question: radio inputs sharing `name="key"`, the option's name in `<b>`, and `<span class="rec">Recommended</span>` on the recommended option. The layer adds a note field. |
| `<main data-plan>` | The annotatable area (default: `<main>`, else `<body>`). |
| `<meta name="plan-version" content="N">` | Recorded in the notes; `process-plan-notes` bumps it. |
| `data-no-annotate` | Leaves an element and its contents alone. |

**No `data-id`s at all?** The page assigns them from the headings: each heading gets its slug (`risks`), the blocks under it are numbered (`risks-1`, `risks-2`…), and a repeated heading becomes `risks--2`. Paragraphs, list items, table rows, code blocks and quotes get Keep / Change / Cut, and each `<h2>` gets a section note. The same content always gets the same ids. `notes.json` then has `"autoIds": true`, and every entry carries `where` and `excerpt` so it can be matched to the source.

## notes.json

```json
{
  "version": 1,
  "plan": "plans/docs-migration/index.html",
  "planVersion": "1",
  "title": "Docs Site Migration",
  "updatedAt": "2026-11-07T14:02:11.000Z",
  "doneAt": "2026-11-07T14:05:40.000Z",
  "autoIds": false,
  "general": "Direction looks right. Tighten the timeline.",
  "items": {
    "ph-2": { "where": "Rollout › Review and redirect", "excerpt": "2 Review and redirect Week 2 …", "verdict": "change", "note": "Two weeks, not one" },
    "approach": { "where": "Section: How it works", "excerpt": "…", "verdict": null, "note": "Section-level note" }
  },
  "highlights": [
    { "id": "k3j9a1x", "n": 1, "blockId": "ap-source", "where": "How it works › One source.", "quote": "Pages are Markdown files", "start": 12, "end": 36, "note": "Per package?", "createdAt": "…" }
  ],
  "decisions": {
    "generator": { "question": "Which generator?", "choice": "docusaurus", "label": "Docusaurus", "recommended": "astro", "note": "We need versioning" }
  }
}
```

| Field | Contents |
|---|---|
| `version` | Schema version (1) |
| `plan`, `planVersion`, `title` | Which plan and which version of it was reviewed |
| `general` | Notes on the plan as a whole |
| `items.<data-id>` | A card, row, phase or section: `verdict` is `keep`, `change`, `cut` or `null`; `note`; `where` (a readable location); `excerpt` (its text). `noteOpen` is UI state. |
| `highlights[]` | A note on selected text: `quote` is the exact text inside the element whose `data-id` is `blockId`, at characters `start`–`end` of that element's text. `n` is the number shown on the page. `orphaned` is set when the text can no longer be found. |
| `decisions.<key>` | `question`, the `choice` (radio value), its `label`, Claude's `recommended` value, and an optional `note` |
| `autoIds` | `true` when the ids were assigned in the browser |
| `doneAt` | When **Done reviewing** was last pressed |

## Development

```bash
npm install          # playwright-core, for the tests only
npm test             # end-to-end tests in Chrome
npm run screenshot   # regenerates docs/screenshot.png
```

The tests drive the system Chrome (`/Applications/Google Chrome.app/…` on macOS; set `CHROME_PATH` elsewhere). They cover: selecting text and saving a note, highlights restored after a reload, Keep / Change / Cut, item, section and general notes, decisions, the server's host, content-type and path checks, reusing a running server, no horizontal scroll at phone width, no console errors, ids assigned to plain HTML, and the standalone bundle.

## License

MIT © TechSnack LLC

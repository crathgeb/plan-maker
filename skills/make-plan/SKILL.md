---
name: make-plan
description: Use when the user asks for a plan, proposal, strategy, roadmap or rollout, or when you are about to present a large multi-part plan in chat. Writes it as an HTML page that breaks the idea into a high-level sequence of phases, each owned by the user or Claude, which the user reviews in the browser like a shared doc. For "guide me through…" or setup instructions use make-guide; for documentation of how a system works use make-reference.
argument-hint: "[what to plan]"
---

# Make Plan

plan-maker writes three kinds of page, all reviewed the same way (comments, questions, **More detail**, drawings, then "process my notes"):

| Kind | For | Skill |
|---|---|---|
| **Plan** | Breaking a larger idea into a high-level sequence of phases | this one |
| **Guide** | Getting the user through one task: their steps, in order | `make-guide` |
| **Reference** | Explaining a system so people can look things up | `make-reference` |

A plan says **what** happens, in what order, who owns each part and why. It does not say how to click through a dashboard: when a phase needs the user to follow steps, that phase links to a guide. Keep a plan high-level. If you're writing a numbered list of commands for the user inside a phase, it belongs in a guide.

## 1. Work out the plan

Do the research first: read the code, check what exists, look up what the options really are. Then decide:

- **The phases.** Three to seven, in order. Each has a goal, an outcome ("done when …") and a rough time ("Week 1", "About a day").
- **Who owns each phase.**
  - **You** (the user): their judgement, their accounts, their money, their clicks.
  - **Claude**: what you can do yourself once they hand off.
  - **Both**: you prepare, they confirm.
- **Which phases need a guide.** A phase owned by the user (or both) that takes more than two or three actions gets a guide. Write the guide now with `make-guide` when the user will need it soon, or leave it for them to request with **Make a guide**.
- **The decisions only they can make.** These become `.decision` blocks.

## 2. Pick the path

Use the path the user names. Otherwise use `plans/<slug>/index.html` from the project root, with a short kebab-case slug, one folder per plan (`notes.json`, `versions/` and `guides/` go beside it). If that folder already holds a plan, this is a revision: use `process-notes`, which saves the current version first. Never write over a plan without that snapshot.

## 3. Write the page

**First read `${CLAUDE_PLUGIN_ROOT}/WRITING.md`**, the rules every plan-maker page follows: content and steps kept apart (only steps and phases are numbered and owned; explanation sits flush), a one-sentence lede on every section, and content written to be understood from its headings, two sentences a block at most.

Copy `${CLAUDE_PLUGIN_ROOT}/templates/plan.html` and replace every piece of example content. Keep `<meta name="pm-kind" content="plan">` and the template's style block exactly as it is (it is shared, word for word, with the guide and reference templates); add page-specific CSS in a second `<style>` element if you must. Shape the sections to fit the plan, and keep the contents rail in sync with them. Write no JavaScript. Keep the page self-contained.

| Mark | Put it on | Rules |
|---|---|---|
| `data-id` | Every block the user might mark | Unique, kebab-case, meaningful (`ph-cutover`, `risk-seo`), and permanent. Progress and notes are stored against them. An edited block keeps its id; a new block gets a new one. |
| `class="item"` | Each thing the user might comment on as a unit: entries, rows (`<tr>`), list items, risks, code blocks | It gets **Comment** and **More detail**. Phases get them too. |
| `<div class="phases">` | The plan's sequence, in a section of its own | One `<article class="phase">` per phase, in order. |
| `class="phase" data-who="you\|claude\|both"` | Every phase | An `<h3>` title, `<div class="when">`, one or two sentences of what happens and why, then `<p class="outcome"><b>Done when</b> …</p>`. The user's phases get **Mark done** and **Make a guide**. |
| `data-status="todo\|doing\|done"` | Every `claude` phase | Start at `todo`. Update it as you work; the page and the hub follow. |
| `<ul class="tasks">` | Optional, Claude's phases only | Three to six short lines, each `<li data-status="todo\|doing\|done">`, so the user can see progress inside the phase. Never the user's steps: those go in a guide. |
| `data-guide="guides/<slug>/index.html"` | A phase done through a guide | The phase shows the guide's name and progress instead of Mark done, links to it, and counts as done when the guide is. The path is relative to the plan. |
| `<pre data-label="…"><code>` | Shapes worth showing: a folder layout, a config sketch | The label shows in the block's header beside **Copy**. |
| `<div class="part" id="information\|steps\|questions">` | The plan's three parts, all three, in that order | Each opens with `<div class="part-h">`: `<p class="part-title" role="heading" aria-level="2">` and one line. Holds sections only. |
| `<section class="sec" id data-id>` | Each major section, inside a part | Starts with an `<h2>` and its one-sentence lede. One per contents entry. |
| `<p class="lede">` | Right after every section's `<h2>` | **Every section opens with one sentence saying what it covers and why it's there**, before any steps, phases, tables or lists. Never start a section straight into its content. |
| `.decision[data-decision="key"]` | Each choice only the user can make | An `<h3>` question, then 2 to 4 radios sharing `name="key"`. Put each option's name in `<b>` with its consequence in one line, and mark your pick with `<span class="rec">Recommended</span>`. Gather them in a "Decisions for you" section in the Questions part. |
| `<p class="slug">` | Under the `<h1>` | `<span>Plan v1</span><span>For review</span><span>DATE</span>`. Match `<meta name="plan-version">` (start at `1`) and `<meta name="plan-date">` (`YYYY-MM-DD`). |
| `<div class="progress" data-pm-progress></div>` | The hero, after the lede | Keep it empty: the review layer draws the phases' progress there. |

**Split the plan into its three parts: Information, Steps, Questions** (`WRITING.md`, "A plan's three parts"). Every section goes in exactly one `<div class="part">`, and the parts come in that order, each opening with its `div.part-h`:

- **Information** (`id="information"`): all the content. The short version, where things stand, options, the design (what gets built), and the **risks**. A design section's lede says it's the design and names the phase that builds it.
- **Steps** (`id="steps"`): the phases section and nothing else. No explanation between phases.
- **Questions** (`id="questions"`): the `.decision` blocks. When nothing is open, keep the part with "Nothing for you to decide right now." in its heading line and no section.

The contents rail mirrors this: `<a class="toc-part" href="#information">Information</a>` and the same for Steps and Questions, each followed by its sections' links. There's no "Contents" title on a plan.

Write for someone skimming in a browser: lead each entry with its point, and keep each phase to what it achieves and why. Write no eyebrow labels and no section or phase numbers yourself (they're drawn for you). Keep heading levels in order: `<h2>` for sections, `<h3>` for entries, phases and decisions. Use sentence case in `<title>`.

**Check the page** before anyone sees it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/check.mjs" <page path>
```

Fix every **error** and run it again until it prints `ok` or only warnings. An error means the page is broken or will lose the reader's notes: a second `<body>` or contents list (part of the template pasted twice), a tag left open, a repeated `data-id`, the template's example left in. Fix the **warnings** too, unless there's a reason (say which in your hand-over): they're `WRITING.md` rules, such as a section with no lede or an entry that runs long. Never hand over a page that fails the check.

## 4. Write the guides it needs now

For each phase the user will act on soon, write its guide with `make-guide` at `plans/<slug>/guides/<guide-slug>/index.html`, with `pm-parent` pointing back at the plan and `pm-parent-phase` naming the phase's `data-id`. Then put `data-guide="guides/<guide-slug>/index.html"` on the phase. Check each guide as well. Later phases can wait for the user's **Make a guide**.

## 5. Start the review server

Run it in the background from the project root:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/review.mjs" plans/<slug>/index.html
```

It opens the plan and prints the URL (`http://127.0.0.1:4478/` or the next free port). If a server is already serving this plan, it reuses it.
- **No browser here:** add `--no-open`.
- **Another device:** add `--host 0.0.0.0`, which prints keyed `net →` URLs (see `review-plan`).
- **Network defaults:** if `PLAN_MAKER_HOST` or `PLAN_MAKER_TRUST` is set, the user has chosen them; give them the `net →` URL too.

A guide's card on the plan opens the guide on its own server; nothing else to start.

## 6. Register it

So it shows in the user's hub (`plan-registry`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/registry.mjs" add plans/<slug>/index.html \
  --name "<short name>" --goal "<the outcome, in one line>" \
  --description "<two or three sentences: what it covers and why>" --next "You: review the plan"
```

It starts as `reviewing`. Register each guide you wrote too (`make-guide` says how); the hub nests them under the plan.

## 7. Hand over

Tell the user, briefly:

- the URL and the plan's path;
- the gist in three to five lines: the phases, which are theirs, and which have guides;
- how to use it: select text to **Comment**, **Ask Claude** or ask for **More detail**, or use the buttons on any block; **Make a guide** on a phase they want walked through; **Mark done** on their phases; answer the decisions;
- to press **Done for now** and say **"process my notes"**.

Done when `check.mjs` passes on the page, the plan exists, follows the conventions, is registered, the server is running, and the user has the URL.

To share it without the server, `node "${CLAUDE_PLUGIN_ROOT}/scripts/bundle.mjs" <plan>` writes a self-contained `<name>.review.html`, plus a copy of each linked guide, linked to each other. Each saves notes in that person's browser, and they send back the file from **Download notes.json**.

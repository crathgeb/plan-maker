---
name: make-reference
description: Use when the user asks for technical reference documentation, a write-up of how a system, API, config, pipeline or codebase area works, a cheat sheet, or "document X" so people can look things up. Writes an HTML reference page with no steps and no progress, built for lookup, which the user reviews in the browser and Claude keeps current. For a sequence of work use make-plan; for steps to follow use make-guide.
argument-hint: "[what to document]"
---

# Make Reference

A **reference** explains a system so people can look things up: commands, options, fields, files, how a process runs, what the terms mean. It has no steps and no progress. (A **plan** sequences work: `make-plan`. A **guide** walks someone through a task: `make-guide`.) It's reviewed like every plan-maker page: comments, questions, **More detail** on any block, then "process my notes" for the next version.

Optimize for someone arriving with a question:

- **Accurate first.** Every name, default and path comes from the source, not memory.
- **Scannable.** Tables for options, definition lists for terms and commands, one idea per entry.
- **Complete within its scope**, and clear about that scope: say which files and which version it describes.
- **Examples next to the thing they illustrate.**

## 1. Read the source

Read the code, config and docs it will describe, in full. Note each option's real name, type and default, each command's real flags, each file's real role. Decide the scope in one sentence, and the files the reference describes: those go in `pm-source`, so the page can tell when it's out of date.

## 2. Pick the path

The path the user names. Otherwise `docs/reference/<slug>/index.html` if the project has a `docs/` folder, else `plans/<slug>/index.html`. If that folder already holds a reference, this is a revision: use `process-notes`, which saves the current version first.

## 3. Write the page

**First read `${CLAUDE_PLUGIN_ROOT}/WRITING.md`**, the rules every plan-maker page follows: content and steps kept apart (only steps and phases are numbered and owned; explanation sits flush), a one-sentence lede on every section, and content written to be understood from its headings, two sentences a block at most.

Copy `${CLAUDE_PLUGIN_ROOT}/templates/reference.html` and replace every piece of example content. Keep `<meta name="pm-kind" content="reference">` and the template's style block exactly as it is (it is shared, word for word, with the plan and guide templates). Write no JavaScript. Keep the page self-contained.

| Mark | Put it on | Rules |
|---|---|---|
| `<meta name="pm-source" content="a/b.mjs, c.json">` | The head | The files it describes, relative to the project root, comma-separated. When one is changed after the reference was written, the page and the hub say it's out of date. |
| `<div class="contents">` | The hero | An `<h2>Contents</h2>` and an `<ol>` linking every section. The side rail mirrors it on wide screens. |
| `<p class="meta">` | The hero | What it describes and as of when: "Describes `docs/build.mjs` … as of 9 Nov 2026." |
| `<section class="sec" id data-id>` | Each topic | An `<h2>`, its one-sentence lede, then the content. One per contents entry. |
| `<p class="lede">` | Right after every section's `<h2>` | **Every section opens with one sentence saying what it covers and why it's there**, before its tables, definitions or examples: what someone looking here will find. Never start a section straight into its content. |
| `<dl class="defs">` | Terms, commands, fields | `<dt class="item" data-id>` then `<dd>`. Code names in `<code>`. |
| tables | Options, files, fields with several attributes | `<tr class="item" data-id>` on every row. Columns like Option, Default, What it does. |
| `<p class="sig">` | A signature or command shape | Monospace, one per shape. |
| `<pre data-label="…"><code>` | Examples and file excerpts | Labelled with the file name or "Example". |
| `.entry`, `ul.tight`, `.note-box` | Overviews and sequences | As in the plan template; every one gets `class="item"` and a `data-id`. |
| `data-id` | Every block | Unique, kebab-case, permanent. |
| `<p class="slug">` | Under the `<h1>` | `<span>Reference v1</span><span>Current</span><span>DATE</span>`, matching `plan-version` and `plan-date`. |
| `<div class="progress" data-pm-progress></div>` | The hero | Keep it: it's where the page says it's out of date. |

Lead each entry with its point. Write in the present tense ("Builds every page into `dist/`"). No steps, no owners, no decisions: if the user needs to choose or do something, that's a plan or a guide, so offer one. Use sentence case in `<title>`.

## 4. Start the review server

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/review.mjs" <reference path>
```

Run it in the background from the project root; `--no-open`, `--host` and the network defaults work as in `make-plan`.

## 5. Register it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/registry.mjs" add <reference path> \
  --name "<short name>" --goal "<what it lets people look up>" \
  --description "<scope, in two sentences>" --next "You: review the reference"
```

It starts as `reviewing`. Once the user is happy with it, set `--status current`. A reference's statuses are `draft`, `reviewing`, `current` and `archived`; whether it's out of date is worked out from `pm-source`, not set by hand.

## 6. Hand over

Tell the user the URL and path, the scope in a line, and how to review it: select text to **Comment**, **Ask Claude** or ask for **More detail**; **Done for now**, then **"process my notes"**.

## Keeping it current

When the user says the reference is out of date, or "refresh the reference", or the hub shows it stale: re-read every `pm-source` file, then revise it as a new version with `process-notes` (it snapshots first), even if there are no notes. Say in "What changed" which source changes you followed.

Done when the reference exists, follows the conventions, names its sources, is registered, the server is running, and the user has the URL.

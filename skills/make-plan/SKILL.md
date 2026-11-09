---
name: make-plan
description: Use when the user asks for a plan, proposal, strategy, roadmap, step-by-step guide, walkthrough, runbook or setup instructions ("guide me through…"), or when you are about to present a large multi-part plan in chat. Writes it as an HTML page the user reviews and works through in the browser, like a shared doc: comments and questions anywhere, their own steps to tick off, Claude's steps with live status.
argument-hint: "[what to plan, or what to guide the user through]"
---

# Make Plan

There is one kind of page: a **plan**. It holds two things:

- **Content to review.** The user comments on anything (select text, or **Comment** on a block), asks Claude questions and answers decisions.
- **Steps**, each its own card, and every step has an owner.
  - **You** (the user), a blue card: they tick it off with **Mark done**.
  - **Claude**, a gold card: it shows the status you set (to do, in progress, done), and the user can't tick it.
  - **Both**: you prepare, they confirm. It's a blue card and counts as theirs.

The top bar shows two progress lines, **You 2/6** and **Claude 7/9**, so the user always knows what's waiting on them. Anything can get a comment, and a comment can be a question for Claude. Everything saves to `notes.json` beside the plan. When the user says "process my notes", the `process-plan-notes` skill writes the next version: it applies their notes, answers their questions in place and keeps their ticked steps.

A walkthrough ("guide me through moving DNS") is a plan whose steps are mostly theirs. A strategy proposal may have no steps at all, or only a few.

## 1. Work out the plan

Do the research first: read the code, check versions, look up the real commands and screens. A step that's wrong loses the reader. Then decide:

- **Who owns each step.**
  - **You**: anything that needs their login, payment, judgement or a click only they can make.
  - **Claude**: anything you can do yourself once they hand off.
  - **Both**: you prepare it and they confirm.
- **The order, in phases.** Group steps into phases (Week 1, or 15–30 minutes each). Put the steps where the user hands results back to you at the right point, with the exact text to paste.
- **Real values versus placeholders.** Use the real paths, project names and URLs you know. For a value only the user has, write a visible placeholder like `<ACCOUNT_ID>`, and fill it in once they give it.
- **The decisions only they can make.** These become `.decision` blocks.

## 2. Pick the path

Use the path the user names. Otherwise use `plans/<slug>/index.html` from the project root, with a short kebab-case slug, one folder per plan (`notes.json` and `versions/` go beside it). If that folder already holds a plan, this is a revision: use `process-plan-notes`, which saves the current version first. Never write over a plan without that snapshot.

## 3. Write the page

Copy `${CLAUDE_PLUGIN_ROOT}/templates/plan.html` and replace every piece of example content. Shape the sections to fit the plan, and keep the contents rail in sync with them. Keep the template's `<style>` block, extending it if you need to. Write no JavaScript. Keep the page self-contained: inline CSS, and images beside the plan referenced by relative path.

| Mark | Put it on | Rules |
|---|---|---|
| `data-id` | Every block the user might mark | Unique, kebab-case, meaningful (`s3-export-dns`, `risk-seo`), and permanent. Progress and notes are stored against them. An edited block keeps its id, and a new block gets a new one. |
| `class="item"` | Each thing the user might comment on as a unit: entries, rows (`<tr>`), list items, risks, code blocks | It gets a **Comment** button. Steps get one too. |
| `class="step" data-who="you\|claude\|both"` | Every action, inside `<div class="steps">` | One action per step. Give each an `<h4>` title (steps sit under a phase `<h3>`). Add `<div class="when">` for time or what it needs ("About 5 minutes · needs your Cloudflare login"), then the body: what to do, the exact thing to paste in a `<pre data-label="Terminal"><code>`, and what they should see when it worked. |
| `<pre data-label="…"><code>` | Every command, file or output | The label shows in the block's dark header beside **Copy**: "Terminal", a file name (`redirects.json`), "Output". One block per thing to paste. |
| `data-status="todo\|doing\|done"` | Every `claude` step | Start at `todo`. Update it as you work, and the page and the hub follow. |
| `<section class="sec" id data-id>` | Each major part | Starts with an `<h2>`. The section number is drawn for you. One per contents entry. |
| `<div class="phase-h"><h3>…</h3><span class="when">…</span></div>` | Above each group of steps | The phase name and when it happens. |
| `.decision[data-decision="key"]` | Each choice only the user can make | An `<h3>` question, then 2 to 4 radios sharing `name="key"`. Put each option's name in `<b>` with its consequence in one line, and mark your pick with `<span class="rec">Recommended</span>`. Gather them in a "Decisions for you" section. |
| `<p class="slug">` | Under the `<h1>` | Three chips: `<span>Plan v1</span><span>For review</span><span>DATE</span>`. Match `<meta name="plan-version">` (start at `1`) and `<meta name="plan-date">` (`YYYY-MM-DD`). |
| `<div class="progress" data-pm-progress></div>` | The hero, after the lede | Keep it empty: the review layer draws the plan's progress bar there. Write no "how to use" box: readers learn the page by using it. |

Write for someone skimming in a browser: lead each entry with its point, keep steps to what's needed to act, and put warnings right before the action they're about. Write no eyebrow labels above headings, and keep heading levels in order: `<h2>` for sections, `<h3>` for entries, phases and decisions, `<h4>` for steps. Write no section or step numbers yourself: each section renders as its own page with a number badge, and its entries, list items, steps and decisions become numbered nodes on a timeline (2.1, 2.2…) automatically.

## 4. Start the review server

Run it in the background from the project root:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/review.mjs" plans/<slug>/index.html
```

It opens the plan and prints the URL (`http://127.0.0.1:4478/` or the next free port). If a server is already serving this plan, it reuses it.
- **No browser here:** add `--no-open`.
- **Another device:** add `--host 0.0.0.0`, which prints keyed `net →` URLs (see `review-plan`).
- **Network defaults:** if `PLAN_MAKER_HOST` or `PLAN_MAKER_TRUST` is set, the user has chosen them; give them the `net →` URL too.

## 5. Register it

So it shows in the user's hub of every plan (`plan-registry`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/registry.mjs" add plans/<slug>/index.html \
  --name "<short name>" --goal "<the outcome, in one line>" \
  --description "<two or three sentences: what it covers and why>" --next "You: review the plan"
```

It starts as `reviewing`. For a walkthrough the user starts right away, add `--status in-progress --next "You: start at <first step>"`.

## 6. Hand over

Tell the user, briefly:

- the URL and the plan's path;
- the gist in three to five lines, including which steps are theirs;
- how to use it: select text to **Comment** or **Ask Claude**, or use **Comment** on any block; **Mark done** on their (blue) steps; the draw tools in the top bar; answer the decisions;
- to press **Done for now** and say **"process my notes"**.

Done when the plan exists, follows the conventions, is registered, the server is running, and the user has the URL.

To share it without the server, `node "${CLAUDE_PLUGIN_ROOT}/scripts/bundle.mjs" <plan>` writes a self-contained `<name>.review.html`. It saves notes in that person's browser, and they send back the file from **Download notes.json**.

---
name: make-guide
description: Use when the user asks to be guided or walked through something ("guide me through moving DNS", "how do I set up Search Console", "walk me through it"), wants setup instructions, a runbook or a checklist they'll follow themselves, or asks for a guide for one of a plan's phases. Writes an HTML page of steps, mostly the user's, optimized for a person following along in the browser and ticking them off.
argument-hint: "[what to guide the user through, or a plan's phase]"
---

# Make Guide

A **guide** gets a person through one task. It's the plan-maker page for doing, not deciding: mostly the user's own steps, in order, one action each, with exactly what to paste and what they should see. (A **plan** breaks a bigger idea into phases: `make-plan`. A **reference** explains how something works: `make-reference`.) It's reviewed like every plan-maker page: comments, questions, **More detail**, then "process my notes".

Optimize for the human doing it, who is switching between this page and another window:

- **What they need comes first**: logins, values to have on hand, tools to install, how long it takes.
- **One action per step.** If a step says "then", it's probably two steps.
- **The exact thing to paste**, in its own block, with real values wherever you know them.
- **What they should see** when it worked, and **what to do if it fails**, right in the step.
- **Claude's steps are short hand-offs** ("Claude checks every old link redirects"): the guide is for the user's part.

## 1. Work out the steps

Do the research first: read the code, check versions, look up the real commands, screens and menu names. A step that's wrong loses the reader. Then decide:

- **Who owns each step.**
  - **You**: anything that needs their login, payment, judgement or a click only they can make.
  - **Claude**: anything you can do yourself once they hand off. Keep these few.
  - **Both**: you prepare it and they confirm.
- **The order, in short groups** (a `phase-h` heading each: "At your registrar", "Once DNS updates").
- **Real values versus placeholders.** Use the real paths, names and URLs you know. For a value only the user has, write a visible placeholder like `<ACCOUNT_ID>`, and fill it in once they give it.
- **Where they hand results back to you**, with the exact text to paste.

## 2. Pick the path

- **A guide for a plan's phase** (from **Make a guide**, or the user asking for one): `plans/<plan>/guides/<guide-slug>/index.html`, inside the plan's folder.
- **A guide on its own**: the path the user names, else `plans/<slug>/index.html` from the project root.

If that folder already holds a guide, this is a revision: use `process-notes`, which saves the current version first.

## 3. Write the page

**First read `${CLAUDE_PLUGIN_ROOT}/WRITING.md`**, the rules every plan-maker page follows: content and steps kept apart (only steps and phases are numbered and owned; explanation sits flush), a one-sentence lede on every section, and content written to be understood from its headings, two sentences a block at most.

Copy `${CLAUDE_PLUGIN_ROOT}/templates/guide.html` and replace every piece of example content. Keep `<meta name="pm-kind" content="guide">` and the template's style block exactly as it is (it is shared, word for word, with the plan and reference templates). Write no JavaScript. Keep the page self-contained.

| Mark | Put it on | Rules |
|---|---|---|
| `<meta name="pm-parent" content="../../index.html">` and `<meta name="pm-parent-phase" content="<phase id>">` | A guide made from a plan's phase | The plan's path relative to this page, and the phase's `data-id`. The page then shows "Part of <plan> › <phase>" above the title, linked. Leave both out for a guide on its own. |
| `<div class="needs item" data-id="needs">` | The hero, after the progress slot | `<h2>What you need</h2>` and a short list: time, logins, values, tools. One caveat the reader must know before starting goes after the list as `<p><b>Good to know:</b> …</p>`. **Nothing else on the cover:** no `.note-box`, no extra boxes; more background is a content section of its own. |
| `<p class="lede">` | Right after every section's `<h2>` | **Every section opens with one sentence saying what it covers and why it's there**, before its first group of steps: what this part gets done ("The two DNS records that point the domain at the new site."). Never start a section straight into its content. |
| `<div class="steps">` under `<div class="phase-h"><h3>…</h3><span class="when">…</span></div>` | Each group of steps | Inside a `<section class="sec" id data-id>` with an `<h2>` and its one-sentence lede. |
| `class="step item" data-who="you\|claude\|both"` | Every step | An `<h4>` title that's the action ("Point docs at the new site"), `<div class="when">` for time and what it needs, then the body. |
| `<pre data-label="…"><code>` | Every command, record or value to paste | The label shows in the block's header beside **Copy**: "Terminal", "DNS record", a file name. One block per thing to paste. |
| `<p class="expect"><b>You should see</b> …</p>` | Steps whose result they can check | What it looks like when it worked. |
| `<p class="iffail"><b>If it fails</b> …</p>` | Steps that commonly go wrong | The likely error, in their words, and what to do. Put rarer problems in the closing "If something goes wrong" table. |
| `data-status="todo\|doing\|done"` | Every `claude` step | Start at `todo`. Update it as you work. |
| `data-id` | Every block | Unique, kebab-case, permanent: the user's ticks are stored against step ids. |
| `<p class="slug">` | Under the `<h1>` | `<span>Guide v1</span><span>Ready to follow</span><span>DATE</span>`, matching `plan-version` and `plan-date`. |
| `<div class="progress" data-pm-progress></div>` | The hero, after the lede | Keep it empty: the review layer draws the steps' progress there. |

Write the steps in the second person, present tense, and lead with the verb. Put warnings right before the action they're about. Write no step numbers yourself (they're drawn for you). End with an "If something goes wrong" table: "You see" → "Do this". Use sentence case in `<title>`.

## 4. Link it to its plan

For a guide made from a plan's phase:

1. On the plan, add `data-guide="guides/<guide-slug>/index.html"` to that phase. If you're writing it in response to the user's **Make a guide**, `process-notes` does this as part of the plan's next version; otherwise edit the plan in place and mark the phase `data-changed="v<N>"`.
2. The phase now shows the guide's progress and is done when every step of the guide is.

**Check the page** before anyone sees it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/check.mjs" <page path>
```

Fix every **error** and run it again until it prints `ok` or only warnings. An error means the page is broken or will lose the reader's notes: a second `<body>` or contents list (part of the template pasted twice), a tag left open, a repeated `data-id`, the template's example left in. Fix the **warnings** too, unless there's a reason (say which in your hand-over): they're `WRITING.md` rules, such as a section with no lede or an entry that runs long. Never hand over a page that fails the check.

## 5. Start the review server

Run it in the background from the project root:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/review.mjs" <guide path>
```

It prints the URL and reuses a server already serving this guide. `--no-open`, `--host` and the network defaults work as in `make-plan`. If the user is starting from the plan, they can also open the guide from the phase's card.

## 6. Register it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/registry.mjs" add <guide path> \
  --name "<short name>" --goal "<the outcome, in one line>" \
  --description "<what it gets them through>" --next "You: start at <first step>"
```

A guide starts as `not-started`. The hub nests a guide under its plan (from `pm-parent`), and it shows as waiting on the user while they have steps left.

## 7. Hand over

Tell the user, briefly:

- the URL and the guide's path;
- how long it takes and what they need ready;
- that they tick each step with **Mark done** (the next one scrolls into view), use **Copy** on every block, and can select text to **Ask Claude** or ask for **More detail** wherever they get stuck;
- to press **Done for now** and say **"process my notes"** when they want the guide fixed or their questions answered.

Done when `check.mjs` passes on the page, the guide exists, follows the conventions, is linked from its plan's phase (if it has one), is registered, the server is running, and the user has the URL.

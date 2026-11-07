---
name: regenerate-guide
description: Use when the user says "regenerate my guide", "answer my questions", "update the guide" or is otherwise done annotating a guide written by guide-me, to answer their questions inside the guide and write its next version.
argument-hint: "[guide path]"
---

# Regenerate Guide

Turns the reader's questions and notes on a guide into its next version. The point is learning:
- **Answer in place.** Every question is answered where it was asked, so the guide gets clearer for this reader.
- **Keep progress.** Steps they've ticked off stay ticked.
- **Keep the record.** The previous version stays one click away, read-only, with their questions on it.

## 1. Load

- **The guide**: the argument, else the guide used in this conversation, else the newest `guides/*/notes.json` (or `plans/*/notes.json` whose plan has `<meta name="pm-kind" content="guide">`). Read the HTML in full.
- **The notes**: `notes.json` beside it.
- **The version N**: `<meta name="plan-version">`.

## 2. Collect every entry

Account for every entry. A question skipped is a question the reader still has.

| Entry | Where it points |
|---|---|
| `items.<id>` with a note | The step, item or section with that `data-id`. `kind` is `question` or `note`. |
| `highlights[]` | The exact `quote` inside the block `blockId`. A question here asks about those words. |
| `drawings[]` | `shape` is `arrow`, `box`, `circle`, `point` or a sticky `note`. It sits on the block `blockId` (`null` means the page) at `x1,y1 → x2,y2`, given as fractions of that block's box. `where` and `excerpt` name the block in words. Work out what the shape points at from its position within the block: a box over the second line of a code block, an arrow from one step to another. A drawing with no note still means "look here": treat it as "explain this" unless the context says otherwise. |
| `steps` | Progress: `{ <step id>: { done: true } }`. It's not feedback, but it tells you where the reader is. |
| `decisions.<key>` | As in plan-maker: an answered decision is settled. |
| `general` | About the whole guide: what they want to learn, what to skip, how much detail. |

Treat the `kind` field as a hint. Any note phrased as a question, or asking "why", "what", "how" or "do I", is a question, whatever its `kind`.

## 3. Show what you'll do

Print one short table, then carry on without waiting:

| # | Where | They asked or said | What the guide will do |
|---|---|---|---|
| 1 | Step 1 › "wrangler login" | "what is wrangler?" | Explain in step 1; add to the glossary |
| 2 | Step 6 (box on the second command) | (no note) | Explain what that command does, line by line |

Then list **Needs your call** for anything you can't answer from what you know or can check: a value only they have, or a note you can't read. Ask about those in chat as well.

## 4. Snapshot, before touching the guide

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/snapshot.mjs" <guide path>
```

This saves `versions/v<N>.html` and moves the notes to `versions/v<N>.notes.json`. For a guide it also writes a fresh `notes.json` for v<N+1> carrying the steps marked done, so the reader's progress survives. Questions and notes stay with v<N>. Edit the guide only after it exits 0. It never overwrites a snapshot.

## 5. Write v<N+1> into the live file

Edit the guide in place; its path and URL stay the same.

- **Answer every question where it was asked.** Add an `aside.explain` inside the step, or next to the item, the question was about, right after the part it concerns:
  ```html
  <aside class="explain" data-q="what-is-wrangler" data-changed="v2">
    <span class="q">What is Wrangler?</span>
    <p>Cloudflare's command-line tool…</p>
  </aside>
  ```
  - **Content:** answer the actual question at the reader's level. Give one or two short paragraphs, plus a concrete example or the exact command where that helps. Say why as well as what.
  - **Wording:** `.q` is their question, tidied, in their words.
  - **Id:** `data-q` is a kebab-case id for the question.
  - **Persistence:** answers stay in later versions. They're the reader's own notes on the guide.
- **Fold answers into the steps** when the question shows the step itself was unclear or wrong: rewrite the step, and keep a short `aside.explain` saying what changed and why.
- **Glossary:** add each term the reader asked about to `section#glossary`, one line each, linking to the step where it's explained.
- **Notes** that aren't questions are edits or context: "this failed with X" means fix the step and add a troubleshooting row; "done, the ID is abc123" means bake the value into every later command.
- **Fill placeholders** with every value the reader has given (in notes or in chat), everywhere they appear.
- **Keep step ids.** Ticked-off progress is stored against them. A new step gets a new id. A step you remove takes its progress with it, so only remove steps that are truly gone.
- **Mark changes:** add `data-changed="v<N+1>"` to every element you added or changed, and remove older `data-changed` attributes.
- **Bump the version:** `<meta name="plan-version" content="N+1">`, `<meta name="plan-date">` to today, and the hero eyebrow to `Guide v<N+1> · your questions answered · <date>`.
- **Don't add a "what changed" section.** The answers sit where the reader asked them, and the "changed in vN" badges show the rest.

## 6. Report

Tell the user how many questions you answered and where (the table is enough), anything that needs their call, and to reload the page. Their progress carried over, and v<N> with their questions is in the version switcher. If the server isn't running, use `review-plan`.

Done when every question and note is accounted for, the snapshot exists, and the live guide is v<N+1> with an answer next to each question.

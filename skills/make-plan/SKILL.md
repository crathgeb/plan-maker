---
name: make-plan
description: Use when the user asks for a plan, proposal, strategy or roadmap to review, or when you are about to present a large multi-part plan in chat. Writes the plan as an HTML page the user annotates in the browser.
argument-hint: "[what to plan]"
---

# Make Plan

The plan becomes an HTML page. The user reviews it in the browser: they select text to add notes, mark items **Keep / Change / Cut**, answer decisions and write general notes. Everything saves to `notes.json` beside the plan. When they say "process my notes", the `process-plan-notes` skill revises the plan.

## 1. Work out the plan

Do the research and thinking first, as you would for any plan. The page is how you deliver it; the substance comes from the work. List what you still need the user to choose: those become decisions (step 3).

## 2. Pick the path

Use the path the user names. Otherwise use `plans/<slug>/index.html` from the project root, with a short kebab-case slug (`plans/docs-migration/index.html`). Give each plan its own folder, because `notes.json` and its archives go beside it. If that folder already holds a plan, this is a revision: use `process-plan-notes` or bump the version (step 4).

## 3. Write the page

Copy `${CLAUDE_PLUGIN_ROOT}/templates/plan.html` and replace every piece of example content. Shape the sections to fit the plan: add, drop and rename them, and keep the table of contents in sync. Keep the template's `<style>` block, extending it if you need to. Write no JavaScript, because the review server injects the annotation layer. Keep the page self-contained: inline CSS, and images beside the plan referenced by relative path.

Follow these conventions; the annotation layer and `process-plan-notes` rely on them:

| Mark | Put it on | Rules |
|---|---|---|
| `data-id` | Every block the user might comment on: each item, section, decision, the hero | Unique, kebab-case, meaningful (`risk-seo`, not `r3`). Ids are permanent: when you revise, an edited block keeps its id and a new block gets a new one. |
| `class="item"` | Each thing the user could accept or reject on its own: cards, phases, steps, options, table rows (`<tr>`), risks, key claims, a code block or a whole table | If you'd want a verdict on it, it's an item. Intro paragraphs, headings and pure background are not. |
| `<section class="sec" id data-id>` | Each major part of the plan | Gets a section note. One per table-of-contents entry. |
| `.decision[data-decision="key"]` | Each choice only the user can make | A heading with the question, 2 to 4 radio options sharing `name="key"` with kebab-case `value`s, each option's name in `<b>` and its consequence in one line. Mark your recommendation with `<span class="rec">Recommended</span>`. Gather the decisions in a final "Decisions for you" section. Choices you can make yourself go in the plan as statements, where the user can still Change or Cut them. |
| `<meta name="plan-version">` and the hero eyebrow | The head and the hero | Start at `1`: `Plan v1 · for review · <date>`. |
| The hero's "How to review" line | The hero | Keep it as in the template, so the user knows what to do. |

Write for a reader skimming in a browser: lead each card with its point, keep items to a few lines, and put the reasoning one level down (a row, a sentence) where the user can still mark it.

## 4. Start the review server

Run it in the background, from the project root, so the conversation stays free:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/review.mjs" plans/<slug>/index.html
```

It opens the plan in the browser and prints the URL (`http://127.0.0.1:4478/`, or the next free port). If a server is already serving this plan, it reuses it. Add `--no-open` when the user can't use a browser on this machine.

## 5. Hand over

Tell the user, briefly:

- the URL and the plan's path;
- the plan's gist in three to five lines (they read the page for the rest);
- how to review: select text → **Add note**, **Keep / Change / Cut** on each item, answer the decisions, notes save to `notes.json` as they go;
- to press **Done reviewing** and say **"process my notes"**.

Done when the plan file exists, follows the conventions, the server is running, and the user has the URL.

To share the plan with someone without the server, `node "${CLAUDE_PLUGIN_ROOT}/scripts/bundle.mjs" <plan>` writes a self-contained `<name>.review.html`. It saves notes in that person's browser, and they send back the file from **Download notes.json**.

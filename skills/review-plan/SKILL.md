---
name: review-plan
description: Use when the user wants to open, review or annotate an existing HTML plan, share one for offline review, or when a plan's review page won't load because its server stopped.
argument-hint: "[plan path]"
---

# Review Plan

Starts (or restarts) the review server for a plan written by `make-plan`, or any HTML page the user wants to annotate.

## 1. Find the plan

The argument, else the plan discussed in this conversation, else the most recently modified `plans/*/index.html`. If several are equally likely, ask which one.

Plain HTML without `data-id`s works too: the page gives every heading and block an id from the headings, and those ids are stable while the content stays the same.

## 2. Start the server

Run it in the background from the project root:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/review.mjs" <plan path> [--port N] [--no-open]
```

- It serves the plan with the annotation layer injected and reads the file fresh on every load, so a reload shows edits.
- It saves to `notes.json` in the plan's folder.
- Default port 4478; if it's taken it uses the next free one and prints the URL.
- If a server is already serving this plan, it prints that server's URL, opens it and exits. Run the command again whenever you're unsure whether the server is up.

## 3. Tell the user

Give the URL, then: select text → **Add note**, **Keep / Change / Cut** on items, answer the decisions, **Done reviewing**, then say **"process my notes"**. If `notes.json` already has notes, they reappear on the page.

## Sharing without the server

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/bundle.mjs" <plan path> [-o out.html] [--with-notes]
```

This writes a single self-contained HTML file (default `<name>.review.html` beside the plan). Opened from disk, it saves in the browser and offers **Download notes.json**; the returned file goes beside the plan as `notes.json`. `--with-notes` starts the copy from the current notes. Images the plan links to are not inlined.

## Stopping

Stop the background task, or kill the `review.mjs` process. Notes are already on disk.

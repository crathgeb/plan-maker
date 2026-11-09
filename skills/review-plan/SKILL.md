---
name: review-plan
description: Use when the user wants to open, review or annotate an existing HTML plan, share one for offline review, or when a plan's review page won't load because its server stopped.
argument-hint: "[plan path]"
---

# Review Plan

Starts (or restarts) the review server for a plan written by `make-plan`, or any HTML page the user wants to annotate.

## 1. Find the plan

The argument, else the plan discussed in this conversation, else one the user names from the registry (`registry.mjs list`), else the most recently modified `plans/*/index.html`. If several are equally likely, ask which one.

Plain HTML without `data-id`s works too: the page gives every heading and block an id from the headings, and those ids are stable while the content stays the same.

## 2. Start the server

Run it in the background from the project root:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/review.mjs" <plan path> [--port N] [--host ADDR] [--no-open]
```

- It serves the plan with the annotation layer injected and reads the file fresh on every load, so a reload shows edits.
- It saves to `notes.json` in the plan's folder.
- Default port 4478; if it's taken it uses the next free one and prints the URL.
- To review from another device (a phone, a tablet, another computer on the network or a VPN), add `--host 0.0.0.0`, or `--host <one address>` to limit it to one network. The server then prints a `net →` URL per address, each carrying a `?key=` that changes every run. Give the user the URL for the network they're on. Without the key, other devices get 403. If `PLAN_MAKER_HOST` or `PLAN_MAKER_TRUST` is set, the user has chosen defaults; don't override them. `--trust tailnet` (devices on their Tailscale network need no key) is only for users who say they use Tailscale.
- If a server is already serving this plan, it prints that server's URL, opens it and exits. Run the command again whenever you're unsure whether the server is up.
- Earlier versions (`versions/v<N>.html`) open read-only at `/versions/v<N>`, with the notes written on them. The version switcher in the top bar lists them all.

## 3. Make sure it's registered

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/registry.mjs" show <plan path> || node "${CLAUDE_PLUGIN_ROOT}/scripts/registry.mjs" add <plan path> --goal "<one line>"
```

A page made before the registry existed gets registered here, so it shows in the hub (`plan-registry`). Read the page for the goal.

## 4. Tell the user

Give the URL, then: select text → **Comment** or **Ask Claude**, **Comment** on any block, **Mark done** on their steps, answer the decisions, **Done for now**, then say **"process my notes"**. If `notes.json` already has notes, they reappear on the page.

## Sharing without the server

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/bundle.mjs" <plan path> [-o out.html] [--with-notes] [--all-versions]
```

This writes a single self-contained HTML file (default `<name>.review.html` beside the plan). Opened from disk, it saves in the browser and offers **Download notes.json**; the returned file goes beside the plan as `notes.json`. `--with-notes` starts the copy from the current notes. `--all-versions` also writes each earlier version as `<name>.review.v<N>.html`, read-only with its notes and linked from the switcher. Images the plan links to are not inlined.

## Stopping

Stop the background task, or kill the `review.mjs` process. Notes are already on disk.

---
name: review-plan
description: Use when the user wants to open, review or annotate an existing plan-maker page (a plan, guide or reference) or any HTML page, share one for offline review, or when a page's review server stopped and it won't load.
argument-hint: "[plan path]"
---

# Review Plan

Starts (or restarts) the review server for a page written by `make-plan`, `make-guide` or `make-reference`, or any HTML page the user wants to annotate. All three kinds are reviewed the same way.

## 1. Find the plan

The argument, else the page discussed in this conversation, else one the user names from the registry (`registry.mjs list`, `--kind guide` to narrow it), else the most recently modified `plans/*/index.html`. If several are equally likely, ask which one.

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
- Links between pages work from the page itself: a plan's phase opens its guide, and a guide's "Part of" line opens its plan, each on its own review server, started on demand.

## 3. Make sure it's registered

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/registry.mjs" show <plan path> || node "${CLAUDE_PLUGIN_ROOT}/scripts/registry.mjs" add <plan path> --goal "<one line>"
```

A page made before the registry existed gets registered here, so it shows in the hub (`plan-registry`). Read the page for the goal. Its kind comes from `<meta name="pm-kind">`.

## 4. Tell the user

Give the URL, then: select text → **Comment**, **Ask Claude** or **More detail**, or the same buttons on any block; **Make a guide** on a plan's phase; **Mark done** on their steps and phases; answer the decisions; **Done for now**, then say **"process my notes"**. If `notes.json` already has notes, they reappear on the page.

## Sharing without the server

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/bundle.mjs" <page path> [-o out.html] [--with-notes] [--all-versions] [--no-guides]
```

This writes a single self-contained HTML file (default `<name>.review.html` beside the plan). Opened from disk, it saves in the browser and offers **Download notes.json**; the returned file goes beside the plan as `notes.json`. `--with-notes` starts the copy from the current notes. `--all-versions` also writes each earlier version as `<name>.review.v<N>.html`, read-only with its notes and linked from the switcher. A plan's guides are bundled with it as `<name>.review.guide-<slug>.html`, linked both ways (`--no-guides` leaves them out). Images the page links to are not inlined.

## Stopping

Stop the background task, or kill the `review.mjs` process. Notes are already on disk.

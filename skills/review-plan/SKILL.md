---
name: review-plan
description: Use when the user wants to open, review or annotate an existing plan-maker page (a plan, guide or reference) or any HTML page, share one for offline review, connect Claude to their pages ("connect", "listen for my notes", the page says "Claude offline"), or when a page's review server stopped and it won't load. For bringing up all of a repo's pages at once ("launch my plans", "launch my docs"), use launch-pages.
argument-hint: "[plan path]"
---

# Review Plan

Starts (or restarts) the review server for a page written by `make-plan`, `make-guide` or `make-reference`, or any HTML page the user wants to annotate. All three kinds are reviewed the same way.

## 1. Find the plan

The argument, else the page discussed in this conversation, else one the user names from the registry (`registry.mjs list`, `--kind guide` to narrow it), else the most recently modified `plans/*/index.html`. If several are equally likely, ask which one.

Plain HTML without `data-id`s works too: the page gives every heading and block an id from the headings, and those ids are stable while the content stays the same.

## 2. Start the server, in this session

The session that will work the reader's notes runs the page's server itself, as a **background task** (Bash with `run_in_background`), so the server and the Claude listening to it live and end together. From the project root:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/review.mjs" <plan path> --replace [--host ADDR] [--no-open]
```

- `--replace` takes the page over: if a server for it is already running (started by the hub, a link, or another session), it stops that one and starts on the same port, so tabs already open on the page reconnect to this one by themselves. A server from an older plan-maker build, without Send to Claude, is replaced even without `--replace`.
- **Once per session.** If this session already started the page's server (its background task is still running), don't run it again: `--replace` would stop your own. Run it again only after that task has ended.
- It serves the plan with the annotation layer injected and reads the file fresh on every load, so a reload shows edits. It saves to `notes.json` in the plan's folder.
- Default port 4478; if it's taken it uses the next free one and prints the URL.
- To review from another device (a phone, a tablet, another computer on the network or a VPN), add `--host 0.0.0.0`, or `--host <one address>` to limit it to one network. The server then prints a `net →` URL per address, each carrying a `?key=` that changes every run. Give the user the URL for the network they're on. Without the key, other devices get 403. If `PLAN_MAKER_HOST` or `PLAN_MAKER_TRUST` is set, the user has chosen defaults; don't override them. `--trust tailnet` (devices on their Tailscale network need no key) is only for users who say they use Tailscale.
- When the session ends, its server stops, and the page says so. Opening the page from the hub starts a server again (with Claude offline); the next session takes it over with `--replace`.
- Earlier versions (`versions/v<N>.html`) open read-only at `/versions/v<N>`, with the notes written on them. The version switcher in the top bar lists them all.
- Links between pages work from the page itself: a plan's phase opens its guide, and a guide's "Part of" line opens its plan, each on its own review server, started on demand. To work a guide's notes from this session too, start its server here the same way.

## 3. Connect Claude

The page's **Send to Claude** hands the reader's notes to the Claude Code session listening to its server: this one. Listen with the **Monitor** tool, one per page this session serves:

- **command:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/listen.mjs" <plan path>`
- **description:** `plan-maker: notes on <page name>`
- **timeout_ms:** `1800000`, the maximum

The page's top bar then says **Claude connected**. **Re-arm** the same Monitor whenever it expires while the user is still reviewing: notes sent while nobody listened wait, and are offered as soon as you reconnect. Each line it prints is an event; `process-notes` says what to do with a job line. If it says the server is an older build, start the server as in step 2 and listen again.

(`listen.mjs --project <root>` listens to every page in the project instead, including servers other sessions started. Use it only when the user wants one session to take everything.)

## 4. Make sure it's registered

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/registry.mjs" show <plan path> || node "${CLAUDE_PLUGIN_ROOT}/scripts/registry.mjs" add <plan path> --goal "<one line>"
```

A page made before the registry existed gets registered here, so it shows in the hub (`plan-registry`). Read the page for the goal. Its kind comes from `<meta name="pm-kind">`.

## 5. Tell the user

Give the URL, then, in a few lines:
- select text → **Comment**, **Ask Claude** or **More detail**, or the same buttons on any block; **Make a guide** on a plan's phase; **Mark done** on their steps and phases; answer the decisions;
- draw from the toolbar at the left: Point (P), Box (B), Circle (C), Arrow (A), Pen (D), Sticky note (N), Select (V) to stop; drag it anywhere by its grip; **F** for focus (just the page);
- press **Send to Claude** when they're done: you write the next version in the background, and the page reloads into it with a line on what changed. Saying **"process my notes"** here does the same.

If `notes.json` already has notes, they reappear on the page.

## Sharing without the server

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/bundle.mjs" <page path> [-o out.html] [--with-notes] [--all-versions] [--no-guides]
```

This writes a single self-contained HTML file (default `<name>.review.html` beside the plan). Opened from disk, it saves in the browser and offers **Download notes.json**; the returned file goes beside the plan as `notes.json`. `--with-notes` starts the copy from the current notes. `--all-versions` also writes each earlier version as `<name>.review.v<N>.html`, read-only with its notes and linked from the switcher. A plan's guides are bundled with it as `<name>.review.guide-<slug>.html`, linked both ways (`--no-guides` leaves them out). Images the page links to are not inlined.

## Stopping

Stop the background task, or kill the `review.mjs` process. Notes are already on disk.

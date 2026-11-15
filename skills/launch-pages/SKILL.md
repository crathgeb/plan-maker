---
name: launch-pages
description: Use when the user says "launch my plans", "launch my docs", "launch everything", "start my plans", "bring my plans up" or similar for the current repo: serves every active plan-maker page in this project from this session, registers them with the hub, takes finished pages off the hub, and connects Claude to their notes.
argument-hint: "[plans | docs | all]"
---

# Launch Pages

Brings up this repo's pages in one go, owned by this session: every active page gets a review server that this session started, Claude listens to all of them, and the hub shows exactly what's still live.

| The user says | Scope | Launches |
|---|---|---|
| "launch my plans" | `plans` | every plan, and the guides made from them |
| "launch my docs" | `docs` | every reference, and the guides that stand alone |
| "launch everything", "launch my pages" | `all` | both |

The project is the git root of the current folder. To launch another repo's pages, pass `--project <dir>`.

## 1. Look before launching

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/launch.mjs" <scope> --dry-run
```

It prints:
- the pages it would register (on disk, not on the hub yet);
- the finished pages it would take off the hub;
- the pages it would launch.

It changes nothing. A page counts as finished when one of these is true:
- its status is `done` or `archived`;
- it's a plan or guide whose every phase and step is done, unless its status is `in-progress` or `blocked` (someone said the work goes on, so it stays);
- it's a guide whose plan is finished.

**A page whose steps are all done but whose status is `in-progress` or `blocked`** is launched, and the dry run names it. Ask the user in one line whether it's finished. If it is, set `--status done` (`registry.mjs update`) before launching, and the launch takes it off the hub.

**A page the user says isn't finished** but the dry run would take off the hub: set its status to `in-progress` before launching (`registry.mjs update <page> --status in-progress`). It then stays.

## 2. Launch, in this session

Run it as a **background task** (Bash with `run_in_background`). The servers are its children, so they live and end with this session:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/launch.mjs" <scope> [--host ADDR]
```

The launch does four things:
- **Registers** every plan-maker page in the project that isn't on the hub yet, and drops entries whose page is gone.
- **Takes finished pages in the scope off the hub,** and doesn't launch them. A later scan or launch leaves them off; `registry.mjs add <page>` brings one back.
- **Starts a review server for each page left,** with `--replace`. A server already serving one of these pages (from the hub, a link, another session or an older build) is taken over on the same port, so the user's open tabs reconnect to it.
- **Prints each page's URL** and the listen command, then keeps running.

**Launch once per session per scope.** Running it again replaces the servers the last run started, and that run then exits.

`--host 0.0.0.0` serves the pages to other devices, as in `review-plan`; each page then prints its own keyed `net →` URL.

## 3. Connect Claude

Use one **Monitor** for every page launched, with the command the launch printed:
- **command:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/listen.mjs" --project <project root>`
- **description:** `plan-maker: notes on <repo name>'s pages`
- **timeout_ms:** `1800000`

Every page's top bar then says **Claude connected**. Re-arm the Monitor when it expires. Each job line it prints is handled as in `process-notes`.

## 4. Finish the registrations

For each page the launch says is newly on the hub:
- read the page;
- set a one-line `goal`, with `registry.mjs update <id> --goal "…"`;
- set `--status` too if the page shows one clearly (see `plan-registry`, "Register existing plans").

## 5. Tell the user

- **The pages:** each one's name and URL, plans first with their guides under them.
- **Taken off the hub:** the pages and why, in one line, and that `registry.mjs add <page>` brings one back.
- **The hub:** its URL if the launch printed one. Otherwise offer to open it (`plan-registry`).
- **That Claude is listening:** Send to Claude on any of these pages comes to this session, and the servers stop when this session ends.

## Stopping

Stop the background task. Its servers stop with it, even if it's killed outright. Notes are already on disk.

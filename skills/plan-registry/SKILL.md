---
name: plan-registry
description: Use when the user asks which plans, guides or references they have, what's in progress or waiting on them, wants their hub / master list / dashboard, wants to register existing pages, or wants a page's status, goal or progress recorded ("mark the billing plan done", "the DNS guide is blocked on IT", "the API reference is current"). Covers every plan-maker page across all projects.
argument-hint: "[open | register | status <plan> <status>]"
---

# Plan Registry

Every plan-maker page (plans from `make-plan`, guides from `make-guide`, references from `make-reference`) is registered in one list across all projects: `~/.plan-maker/registry.json`, or `$PLAN_MAKER_HOME/registry.json` if that's set. The **hub** is a page that shows them all.

- **Sidebar:** each project, with its pages beneath it, each marked with its kind. A guide made from a plan sits under that plan. Pages waiting on the user come first, the rest follow by most recent. A filter shows all, or only plans, guides or references.
- **Opening view:** everything waiting on the user, across all projects.
- **A selected page:** the page itself, live, with its name, status and progress in its own top bar.

The registry exists so the user never has to wonder what's in progress. Keep it true: when a page's state changes in conversation, record it.

## Fields

| Field | What to write |
|---|---|
| `name` | Short and recognizable, as the user would say it. Defaults to the page's `<title>`. |
| `goal` | One line: the outcome when this is finished, not the activity ("Docs publish on merge", not "Migrate docs"). |
| `description` | Two or three sentences: what it covers and why it matters. Defaults to the hero's lede. |
| `status` | Depends on the page's kind (from its `<meta name="pm-kind">`). **Plan**: `draft`, `reviewing`, `approved` (agreed, work not started), `in-progress`, `blocked` (say on what in `next`), `done`, `archived`. **Guide**: `draft`, `reviewing`, `not-started`, `in-progress`, `blocked`, `done`, `archived`. **Reference**: `draft`, `reviewing`, `current`, `archived`. New plans and references start `reviewing`, new guides `not-started`. A status another kind uses is refused. |
| `next` | The single next action and who takes it ("You: answer the 2 decisions", "Claude: build phase 2"). Clear it when nothing is pending. |
| `log` | One dated line per real event: a version written, a phase finished, a blocker, a decision taken. The status-change lines are added automatically. |

The kind, version, each owner's progress (a plan's phases, a guide's steps), a plan's linked guides, open decisions, unprocessed notes, guide requests, a reference's staleness and the reasons it's waiting on the user are read live from the page and its `notes.json`. Don't copy them into the fields. A plan's phase linked to a guide counts as done when the guide is.

**Waiting on you** is worked out for you:
- a page to review;
- decisions to answer;
- notes to hand to Claude ("process my notes"), including guides requested with **Make a guide**;
- the user's steps or phases left on an approved, not-started or in-progress page (a phase done through a guide waits in the guide, not the plan);
- a reference whose source files changed since it was written;
- a block whose `next` starts with "You".

To change what it says, change the status or `next`.

## Commands

```bash
R="${CLAUDE_PLUGIN_ROOT}/scripts/registry.mjs"
node "$R" add <page> --name "…" --goal "…" --description "…" [--status S] [--next "…"]
node "$R" update <page|id> [--status S] [--next "…"] [--goal "…"] [--log "what happened"]   # registers it if needed
node "$R" list [--all] [--project NAME] [--kind plan|guide|reference] [--json]     # active only, unless --all
node "$R" show <page|id>
node "$R" scan [dir]       # register every plan-maker page under dir (HTML with a plan-version or pm-kind meta), guides inside plans included
node "$R" remove <page|id> # drops the entry; the page is untouched
node "$R" prune            # drops entries whose page is gone
```

`<page>` is the HTML file or its folder, relative to the current directory.

## Open the hub

Run it in the background:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs"
```

It opens `http://127.0.0.1:4477/` (or the next free port below it) and reuses a hub that's already running. The page refreshes itself, and the user can change a status from the card. **Open** on a card starts that page's review server, or reuses it, and goes there. The hub only listens on this machine.

Give the user the URL and a short summary from `list`: what's waiting on them first, then what's in progress or blocked.

## Register existing plans

When the user says "register my plans", or the hub is missing pages they have:

1. Run `scan` from the project root. Repeat for each project they name.
2. For each newly registered entry, read the page and set `goal` and `description` (and `name` if the title is vague) with `update`. Infer `status` from what you can see:
   - notes waiting with `doneAt` set → `reviewing`;
   - every step or phase done → `done`;
   - a reference the user relies on → `current`;
   - otherwise ask, briefly, in one list, rather than guess.
3. Show the result with `list`.

## Keep it current

Other skills register and log as they go. Do it yourself when the conversation changes a plan's state outside those skills:

- the user approves a plan → `--status approved --next "…"`;
- the user starts a guide → `--status in-progress`; a reference is agreed → `--status current`;
- you start or finish building from a plan → `--status in-progress` / `--status done`, with a `--log` line for each phase finished;
- the work is stuck → `--status blocked --next "Waiting on …"`;
- a plan is replaced or dropped → `--status archived --log "Superseded by …"`.

Done when the registry reflects what the user just told you, and, if they asked to see it, the hub is running and they have the URL.

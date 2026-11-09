---
name: plan-registry
description: Use when the user asks which plans they have, what's in progress or waiting on them, wants their plan hub / master list / dashboard, wants to register existing plans, or wants a plan's status, goal or progress recorded ("mark the billing plan done", "the DNS setup is blocked on IT"). Covers every plan across all projects.
argument-hint: "[open | register | status <plan> <status>]"
---

# Plan Registry

Every plan (`make-plan`) is registered in one list across all projects: `~/.plan-maker/registry.json`, or `$PLAN_MAKER_HOME/registry.json` if that's set. The **hub** is a page that shows them all.

- **Sidebar:** each project, with its plans nested beneath it. Plans waiting on the user come first, the rest follow by most recent.
- **Opening view:** everything waiting on the user, across all projects.
- **A selected plan:** its name, goal, description, status and next action, plus two progress lines (**You** in red, **Claude** in blue) and why it's waiting on them. It also shows the progress log and an **Open** button that starts the plan's review server if it isn't running.

The registry exists so the user never has to wonder which plans are in progress. Keep it true: when a plan's state changes in conversation, record it.

## Fields

| Field | What to write |
|---|---|
| `name` | Short and recognizable, as the user would say it. Defaults to the page's `<title>`. |
| `goal` | One line: the outcome when this is finished, not the activity ("Docs publish on merge", not "Migrate docs"). |
| `description` | Two or three sentences: what it covers and why it matters. Defaults to the hero's lede. |
| `status` | `draft`, `reviewing` (a plan the user is reviewing), `approved` (a plan agreed, work not started), `in-progress`, `blocked` (say on what in `next`), `done`, `archived` (dropped or superseded). A new plan starts `reviewing`; a walkthrough the user starts right away, `in-progress`. |
| `next` | The single next action and who takes it ("You: answer the 2 decisions", "Claude: build phase 2"). Clear it when nothing is pending. |
| `log` | One dated line per real event: a version written, a phase finished, a blocker, a decision taken. The status-change lines are added automatically. |

Version, each owner's steps done, open decisions, unprocessed notes and the reasons it's waiting on the user are read live from the page and its `notes.json`. Don't copy them into the fields.

**Waiting on you** is worked out for you:
- a plan to review;
- decisions to answer;
- notes to hand to Claude ("process my notes");
- the user's steps left on an approved or in-progress plan;
- a block whose `next` starts with "You".

To change what it says, change the status or `next`.

## Commands

```bash
R="${CLAUDE_PLUGIN_ROOT}/scripts/registry.mjs"
node "$R" add <page> --name "…" --goal "…" --description "…" [--status S] [--next "…"]
node "$R" update <page|id> [--status S] [--next "…"] [--goal "…"] [--log "what happened"]   # registers it if needed
node "$R" list [--all] [--project NAME] [--json]     # active only, unless --all
node "$R" show <page|id>
node "$R" scan [dir]       # register every plan-maker page under dir (HTML with a plan-version meta)
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
   - every step done → `done`;
   - otherwise ask, briefly, in one list, rather than guess.
3. Show the result with `list`.

## Keep it current

Other skills register and log as they go. Do it yourself when the conversation changes a plan's state outside those skills:

- the user approves a plan → `--status approved --next "…"`;
- you start or finish building from a plan → `--status in-progress` / `--status done`, with a `--log` line for each phase finished;
- the work is stuck → `--status blocked --next "Waiting on …"`;
- a plan is replaced or dropped → `--status archived --log "Superseded by …"`.

Done when the registry reflects what the user just told you, and, if they asked to see it, the hub is running and they have the URL.

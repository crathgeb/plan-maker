---
name: process-plan-notes
description: Use when the user says "process my notes", "I've reviewed the plan", "answer my questions", "regenerate my guide" or is otherwise done with a round on an HTML plan, to write its next version from notes.json: apply their notes, answer their questions in place, keep their ticked steps.
argument-hint: "[plan path]"
---

# Process Plan Notes

Turns the user's round on a plan into its next version:

- **Apply** their comments and decisions.
- **Answer** every question where it was asked.
- **Keep** the steps they ticked off.

The previous version stays read-only, with the notes written on it, and the user can reopen it from the version switcher on the page.

## 1. Load

- **The plan**: the argument, else the plan reviewed in this conversation, else the newest `plans/*/notes.json`. Read the plan's HTML in full.
- **The notes**: `notes.json` beside the plan. If it's missing, the user may have reviewed offline: look for the newest `notes.json` in `~/Downloads` and ask before using it (copy it beside the plan as `notes.json`).
- **The version N**: `<meta name="plan-version">` in the plan (else "Plan v<N>" in its slug). `planVersion` in the notes should match.

## 2. Map every entry to the plan

Account for every entry; skipping one silently loses the user's feedback.

| Entry | What it points at |
|---|---|
| `general` | The plan as a whole |
| `items.<id>` | The element with `data-id="<id>"`: an entry, row, step or section (`where` starting `Section:`). `note` is the comment; `kind` is `question` or `note`. Skip entries with an empty note. Notes from older plans may also carry a `verdict` (`keep`, `change`, `cut`): treat it as in the table below. |
| `highlights[]` | The exact `quote` inside the element with `data-id = blockId`. The note is about that wording; `kind` says whether it's a question. |
| `steps` | Progress, not feedback: `{ <step id>: { done: true } }` for the user's steps they ticked off. It tells you where they are. |
| `decisions.<key>` | The `.decision[data-decision="<key>"]` block. `choice` and `label` are the answer, `recommended` was yours, `note` qualifies it. |
| `drawings[]` | A mark the user drew: `shape` is `arrow`, `box`, `circle`, `point` or a sticky `note`. It sits on the block `blockId` (`null` = the page) at `x1,y1 → x2,y2`, fractions of that block's box; `where`/`excerpt` name it in words. Work out what it points at from its position in the block (a circle round one row, an arrow from one card to another). A note on it is the feedback; a mark with no note means "look at this": treat it as a question about that spot, or list it under **Needs your call** if you can't tell what it wants. |

`where` and `excerpt` name each spot in words. When `autoIds` is `true`, the ids were assigned in the browser (from headings: `goals`, `goals-1`, `goals-2`…, and `goals--2` for a repeated heading), so locate those elements by `where`, `excerpt` and `quote`.

## 3. Decide what each entry means

| Feedback | Treat it as |
|---|---|
| A comment asking to remove something (or an old `cut` verdict) | Removal. Delete the element and everything that depends on it: table-of-contents entries, summary lines, later steps that assume it. Say what replaces it, if anything. |
| A comment asking for a change (or an old `change` verdict) | An edit, made as it says. If it says something's wrong but not what to do, it needs a decision: list it. |
| A comment approving something ("yes", "good", an old `keep`) | Confirmation. Leave its substance alone and keep it consistent when you edit around it. |
| A question (`kind: "question"`, or any note asking why, what, how or "do I") | Answer it in the plan, where it was asked (step 6). If it shows the step itself was unclear or wrong, fix the step too. |
| Any other comment | Context for the edits. "This failed with X" means fix the step and add a row to the troubleshooting table. "Done, the ID is abc123" means put that value in every later command. |
| A highlight | Applies to the quoted wording specifically. |
| An answered decision | Settled. Rewrite the plan to follow the choice, carry its consequences through (more so when it differs from `recommended`), and remove the decision block. |
| An unanswered decision | Still open: keep it. |
| `general` | Plan-wide direction: apply it across sections. |

When two entries conflict (an approving comment on an entry, but a highlight inside it asks for a rewrite), the more specific one wins; if that's still unclear, it needs a decision.

## 4. Show the changes

Print one short table, then carry on without waiting:

| # | Where | Feedback | Change |
|---|---|---|---|
| 1 | Rollout › Generate the redirect map | "two weeks, not one" | Review and redirect becomes weeks 2–3; later steps shift |
| 2 | Step 1 › "wrangler" | Asked: "what is wrangler?" | Answered in step 1 |

Group entries that lead to one change into one row. Then list **Needs your call**: comments that say something's wrong without saying what, unclear notes, conflicts. Leave those parts of the plan as they are.

## 5. Snapshot, before touching the plan

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/snapshot.mjs" <plan path>
```

It copies the plan to `versions/v<N>.html` and moves `notes.json` (or an older `notes-v<N>.json`) to `versions/v<N>.notes.json`. It then writes a fresh `notes.json` for v<N+1> carrying the steps the user ticked off, so their progress survives. It never overwrites a snapshot: run twice, it reports "already saved". Edit the plan only after it exits 0. If it refuses, read its message and fix the cause; a snapshot is the user's only copy of what they reviewed, so it is never deleted or replaced to make the script pass.

## 6. Write v<N+1> into the live file

Edit the plan file in place (its path stays the same, so the user's URL keeps working):

- Make every change from the table. Keep the conventions from `make-plan`. Edited elements keep their `data-id`; new elements get new ids; ids of cut elements are not reused. If the plan relied on ids assigned in the browser (`autoIds`), write explicit `data-id`s and `class="item"`s now, reusing the auto ids where the element survives.
- Mark every element you edited or added with `data-changed="v<N+1>"`: the page shows it with a "changed in v<N+1>" badge. Remove `data-changed` attributes left from earlier rounds.
- **Answer every question where it was asked.** Add an `aside.explain` inside the step or entry it was about, right after the part it concerns:
  ```html
  <aside class="explain" data-q="what-is-wrangler" data-changed="v2">
    <span class="q">What is Wrangler?</span>
    <p>Cloudflare's command-line tool…</p>
  </aside>
  ```
  Answer the actual question at their level, in one or two short paragraphs. Add an example or the exact command where it helps. `.q` is their question, tidied, in their words. Answers stay in later versions.
- **Keep step ids.** Ticked-off progress is stored against them. A new step gets a new id, and only remove steps that are truly gone.
- **Claude's steps:** set `data-status` (`todo`, `doing`, `done`) to match what you've actually done.
- **Fill placeholders** with every value the user has given, in notes or in chat.
- Write **What changed in v<N+1>** as the first section, `section#changes`, replacing the previous version's: copy the shape of `${CLAUDE_PLUGIN_ROOT}/templates/changes-section.html`. One row per change, "You said" in the user's words, "What changed" with `§` links to the sections it touched; a "Decided" line for each answered decision; a first entry in the contents. Answered questions don't need a row: their answers sit where they were asked.
- Bump the version: `<meta name="plan-version" content="N+1">`, `<meta name="plan-date">` to today, and the slug to `<span>Plan v<N+1></span><span>Your v<N> notes applied</span><span><date></span>`.
- Add new decisions where the notes opened new questions.

## 7. Update the registry

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/registry.mjs" update <plan path> --log "v<N+1>: <the main changes, in a few words>" --next "<what's next>"
```

This registers the plan if it isn't registered yet. Then set the status:
- `--status approved` if the notes approve the plan and nothing needs their call;
- `--status in-progress` if work has started;
- `--status done` (and `--next ""`) if every step is done;
- `--status blocked`, with `--next` saying what's awaited, if they're stuck on someone else.

## 8. Report

Tell the user what changed and which questions you answered (the table is enough). List anything that needs their call, and give the plan's URL to reload. Their ticked steps carried over. v<N> and its notes stay one click away in the version switcher. If the server isn't running, use `review-plan`.

Done when every entry is accounted for in the table or in **Needs your call**, `versions/v<N>.html` and `versions/v<N>.notes.json` exist, the live plan is v<N+1> with its `#changes` section and an answer beside every question, and the registry has a log line for v<N+1>.

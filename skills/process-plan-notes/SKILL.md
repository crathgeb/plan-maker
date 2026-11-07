---
name: process-plan-notes
description: Use when the user says "process my notes", "I've reviewed the plan" or is otherwise done annotating an HTML plan, to revise the plan from its notes.json.
argument-hint: "[plan path]"
---

# Process Plan Notes

Turns the user's review of an HTML plan into the next version of that plan. The reviewed version is kept, read-only, with the notes written on it: the user can open it again from the version switcher (**v2 ▾**) on the page.

## 1. Load

- **The plan**: the argument, else the plan reviewed in this conversation, else the newest `plans/*/notes.json`. Read the plan's HTML in full.
- **The notes**: `notes.json` beside the plan. If it's missing, the user may have reviewed offline: look for the newest `notes.json` in `~/Downloads` and ask before using it (copy it beside the plan as `notes.json`).
- **The version N**: `<meta name="plan-version">` in the plan (else "Plan v<N>" in its hero). `planVersion` in the notes should match.

## 2. Map every entry to the plan

Account for every entry; skipping one silently loses the user's feedback.

| Entry | What it points at |
|---|---|
| `general` | The plan as a whole |
| `items.<id>` | The element with `data-id="<id>"`: a card, row, phase or section (`where` starting `Section:`). `verdict` is `keep`, `change`, `cut` or `null`. Skip entries with no verdict and an empty note. |
| `highlights[]` | The exact `quote` inside the element with `data-id = blockId`. The note is about that wording. |
| `decisions.<key>` | The `.decision[data-decision="<key>"]` block. `choice` and `label` are the answer, `recommended` was yours, `note` qualifies it. |
| `drawings[]` | A mark the user drew: `shape` is `arrow`, `box`, `circle`, `point` or a sticky `note`. It sits on the block `blockId` (`null` = the page) at `x1,y1 → x2,y2`, fractions of that block's box; `where`/`excerpt` name it in words. Work out what it points at from its position in the block (a circle round one row, an arrow from one card to another). A note on it is the feedback; a mark with no note means "look at this": treat it as a question about that spot, or list it under **Needs your call** if you can't tell what it wants. |

`where` and `excerpt` name each spot in words. When `autoIds` is `true`, the ids were assigned in the browser (from headings: `goals`, `goals-1`, `goals-2`…, and `goals--2` for a repeated heading), so locate those elements by `where`, `excerpt` and `quote`.

## 3. Decide what each entry means

| Feedback | Treat it as |
|---|---|
| **Cut** | Removal. Delete the element and everything that depends on it: table-of-contents entries, summary lines, later steps that assume it. A note on a cut says why, or what replaces it. |
| **Change** with a note | An edit, made as the note says. |
| **Change** without a note | Needs a decision: list it and ask what should change. |
| **Keep** | Confirmation. The item is settled: leave its substance alone and keep it consistent when you edit around it. |
| A note with no verdict | An edit if it asks for one; a question to answer in the plan if it asks one; otherwise context for the edits. |
| A highlight | Applies to the quoted wording specifically. |
| An answered decision | Settled. Rewrite the plan to follow the choice, carry its consequences through (more so when it differs from `recommended`), and remove the decision block. |
| An unanswered decision | Still open: keep it. |
| `general` | Plan-wide direction: apply it across sections. |

When two entries conflict (Keep on a card, but a highlight inside it asks for a rewrite), the more specific one wins; if that's still unclear, it needs a decision.

## 4. Show the changes

Print one short table, then carry on without waiting:

| # | Where | Feedback | Change |
|---|---|---|---|
| 1 | Phases › Review and redirect | CHANGE: "two weeks, not one" | Phase 2 becomes weeks 2–3; later phases shift |

Group entries that lead to one change into one row. Then list **Needs your call**: Change without a note, unclear notes, conflicts. Leave those parts of the plan as they are.

## 5. Snapshot, before touching the plan

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/snapshot.mjs" <plan path>
```

It copies the plan to `versions/v<N>.html` and moves `notes.json` (or an older `notes-v<N>.json`) to `versions/v<N>.notes.json`. It never overwrites a snapshot: run twice, it reports "already saved". Edit the plan only after it exits 0. If it refuses, read its message and fix the cause; a snapshot is the user's only copy of what they reviewed, so it is never deleted or replaced to make the script pass.

## 6. Write v<N+1> into the live file

Edit the plan file in place (its path stays the same, so the user's URL keeps working):

- Make every change from the table. Keep the conventions from `make-plan`. Edited elements keep their `data-id`; new elements get new ids; ids of cut elements are not reused. If the plan relied on ids assigned in the browser (`autoIds`), write explicit `data-id`s and `class="item"`s now, reusing the auto ids where the element survives.
- Mark every element you edited or added with `data-changed="v<N+1>"`: the page shows it with a "changed in v<N+1>" badge. Remove `data-changed` attributes left from earlier rounds.
- Write **What changed in v<N+1>** as the first section, `section#changes`, replacing the previous version's: copy the shape of `${CLAUDE_PLUGIN_ROOT}/templates/changes-section.html`. One row per change, "You said" in the user's words, "What changed" with `§` links to the sections it touched; a "Decided" line for each answered decision; a first entry in the table of contents.
- Bump the version: `<meta name="plan-version" content="N+1">`, `<meta name="plan-date">` to today, and the hero eyebrow to `Plan v<N+1> · your v<N> notes applied · <date>`.
- Add new decisions where the notes opened new questions.

## 7. Report

Tell the user what changed (the table is enough), list anything that needs their call, and give the plan's URL to reload. v<N> and its notes stay one click away in the version switcher. If the server isn't running, use `review-plan`.

Done when every entry is accounted for in the table or in **Needs your call**, `versions/v<N>.html` and `versions/v<N>.notes.json` exist, and the live plan is v<N+1> with its `#changes` section.

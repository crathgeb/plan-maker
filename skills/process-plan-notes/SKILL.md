---
name: process-plan-notes
description: Use when the user says "process my notes", "I've reviewed the plan" or is otherwise done annotating an HTML plan, to revise the plan from its notes.json.
argument-hint: "[plan path]"
---

# Process Plan Notes

Turns the user's review of an HTML plan into the next version of that plan.

## 1. Load

- **The plan**: the argument, else the plan reviewed in this conversation, else the newest `plans/*/notes.json`. Read the plan's HTML in full.
- **The notes**: `notes.json` beside the plan. If it's missing, the user may have reviewed offline: look for the newest `notes.json` in `~/Downloads` and ask before using it.
- **The version**: `planVersion` in the notes, else `<meta name="plan-version">` in the plan.

## 2. Map every entry to the plan

Account for every entry; skipping one silently loses the user's feedback.

| Entry | What it points at |
|---|---|
| `general` | The plan as a whole |
| `items.<id>` | The element with `data-id="<id>"`: a card, row, phase or section (`where` starting `Section:`). `verdict` is `keep`, `change`, `cut` or `null`. Skip entries with no verdict and an empty note. |
| `highlights[]` | The exact `quote` inside the element with `data-id = blockId`. The note is about that wording. |
| `decisions.<key>` | The `.decision[data-decision="<key>"]` block. `choice` and `label` are the answer, `recommended` was yours, `note` qualifies it. |

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
| An answered decision | Settled. Rewrite the plan to follow the choice, carry its consequences through (more so when it differs from `recommended`), remove the decision block, and list it under "Decided" in the summary. |
| An unanswered decision | Still open: keep it. |
| `general` | Plan-wide direction: apply it across sections. |

When two entries conflict (Keep on a card, but a highlight inside it asks for a rewrite), the more specific one wins; if that's still unclear, it needs a decision.

## 4. Show the changes

Print one short table, then carry on without waiting:

| # | Where | Feedback | Change |
|---|---|---|---|
| 1 | Phases › Review and redirect | CHANGE: "two weeks, not one" | Phase 2 becomes weeks 2–3; later phases shift |

Group entries that lead to one change into one row. Then list **Needs your call**: Change without a note, unclear notes, conflicts. Leave those parts of the plan as they are.

## 5. Revise the plan

- Make every change from the table, in the HTML.
- Keep the conventions from `make-plan`. Edited elements keep their `data-id`; new elements get new ids; ids of cut elements are not reused. If the plan relied on ids assigned in the browser (`autoIds`), write explicit `data-id`s and `class="item"`s now, reusing the auto ids where the element survives.
- Bump the version: `<meta name="plan-version">` and the hero's `Plan v<N>` both go to N+1, with today's date.
- Put a short "Changes in v<N+1>" callout in the hero, replacing any earlier one: three to six bullets on what changed.
- Add new decisions where the notes opened new questions.

## 6. Archive the notes

Move `notes.json` to `notes-v<N>.json` in the same folder, where N is the version that was reviewed. The next round starts clean, and the old feedback stays on file.

## 7. Report

Tell the user what changed (the table is enough), list anything that needs their call, and give the plan's URL to reload. If the server isn't running, use `review-plan`.

Done when every entry is accounted for in the table or in **Needs your call**, the plan is at the new version, and `notes.json` is archived.

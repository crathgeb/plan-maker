---
name: process-notes
description: Use when the user says "process my notes", "I've reviewed the plan", "answer my questions", "make the guide I asked for", "refresh the reference" or is otherwise done with a round on a plan-maker page (a plan, guide or reference), to write its next version from notes.json. Applies their comments, answers their questions in place, adds the detail they asked for, writes the guides they requested from a plan's phases, and keeps what they ticked off.
argument-hint: "[page path]"
---

# Process Notes

Turns the user's round on a plan-maker page into its next version. It works the same on all three kinds (`<meta name="pm-kind">`: `plan`, `guide`, `reference`; none means plan):

- **Apply** their comments and decisions.
- **Answer** every question where it was asked.
- **Expand** every block they asked **More detail** on.
- **Write a guide** for every plan phase they pressed **Make a guide** on, and link it.
- **Keep** what they ticked off.

The previous version stays read-only, with the notes written on it, and the user can reopen it from the version switcher on the page.

## 1. Load

- **The page**: the argument, else the page reviewed in this conversation, else the newest `notes.json` under `plans/` or `docs/`. Read the page's HTML in full, and note its kind.
- **The notes**: `notes.json` beside the page. If it's missing, the user may have reviewed offline: look for the newest `notes.json` in `~/Downloads` and ask before using it (copy it beside the page as `notes.json`).
- **The version N**: `<meta name="plan-version">` (else "Plan v<N>" in its slug). `planVersion` in the notes should match.
- **The writing rules**: `${CLAUDE_PLUGIN_ROOT}/WRITING.md` for every page, and `make-plan`, `make-guide` or `make-reference` for its kind. The next version follows them, including where the page you're revising doesn't yet: content written as steps (or numbered), sections with no lede, and blocks that run long get fixed in the sections you touch.

## 2. Map every entry to the page

Account for every entry; skipping one silently loses the user's feedback.

| Entry | What it points at |
|---|---|
| `general` | The page as a whole |
| `items.<id>` | The element with `data-id="<id>"`: an entry, row, step, phase or section (`where` starting `Section:`). `kind` says what it asks (below). `note` is their words, which can be empty for `detail` and `guide`. Skip a `note` or `question` with an empty note. Notes from older pages may carry a `verdict` (`keep`, `change`, `cut`): treat it as in the table below. |
| `highlights[]` | The exact `quote` inside the element with `data-id = blockId`. `kind` is `note`, `question` or `detail`. |
| `steps` | Progress, not feedback: `{ <id>: { done: true } }` for the user's steps (or phases) they ticked off. It tells you where they are. |
| `decisions.<key>` | The `.decision[data-decision="<key>"]` block. `choice` and `label` are the answer, `recommended` was yours, `note` qualifies it. |
| `drawings[]` | A mark the user drew: `shape` is `arrow`, `box`, `circle`, `point` or a sticky `note`. It sits on the block `blockId` (`null` = the page) at `x1,y1 → x2,y2`, fractions of that block's box; `where`/`excerpt` name it in words. Work out what it points at from its position in the block. A note on it is the feedback; a mark with no note means "look at this": treat it as a question about that spot, or list it under **Needs your call** if you can't tell what it wants. |

`where` and `excerpt` name each spot in words. When `autoIds` is `true`, the ids were assigned in the browser (from headings: `goals`, `goals-1`, `goals-2`…, and `goals--2` for a repeated heading), so locate those elements by `where`, `excerpt` and `quote`.

## 3. Decide what each entry means

| Feedback | Treat it as |
|---|---|
| `kind: "guide"` on a plan's phase | **Write a guide for that phase** (step 6). Their note, if any, says what it should assume or cover. |
| `kind: "detail"` | **Expand that block**, at the depth its kind calls for. A plan's phase: more on what happens and why, and its outcome; if what's missing is the user's steps, offer a guide instead (list it under **Needs your call**). A guide's step: split it into smaller steps, each with what to paste and what they should see. A reference's entry, row or section: go deeper, with an example. Their note says what they want more on. |
| A comment asking to remove something (or an old `cut` verdict) | Removal. Delete the element and everything that depends on it: contents entries, summary lines, later steps that assume it. Say what replaces it, if anything. |
| A comment asking for a change (or an old `change` verdict) | An edit, made as it says. If it says something's wrong but not what to do, it needs a decision: list it. |
| A comment approving something ("yes", "good", an old `keep`) | Confirmation. Leave its substance alone and keep it consistent when you edit around it. |
| A question (`kind: "question"`, or any note asking why, what, how or "do I") | Answer it on the page, where it was asked (step 7). If it shows the step itself was unclear or wrong, fix the step too. |
| Any other comment | Context for the edits. "This failed with X" means fix the step and add a row to the troubleshooting table. "Done, the ID is abc123" means put that value in every later command. |
| A highlight | Applies to the quoted wording specifically. |
| An answered decision | Settled. Rewrite the page to follow the choice, carry its consequences through (more so when it differs from `recommended`), and remove the decision block. |
| An unanswered decision | Still open: keep it. |
| `general` | Page-wide direction: apply it across sections. |
| A reference whose `pm-source` files changed (the page says "Out of date", or the user says "refresh") | Re-read every source and correct the reference, even with no notes. |

When two entries conflict, the more specific one wins; if that's still unclear, it needs a decision.

## 4. Show the changes

Print one short table, then carry on without waiting:

| # | Where | Feedback | Change |
|---|---|---|---|
| 1 | Phases › Switch the domain over | Make a guide | New guide `guides/dns-cutover/`; the phase links to it |
| 2 | Phases › Review the pages | More detail: "what am I checking for?" | Added what to check and how to flag it |
| 3 | Step 1 › "wrangler" | Asked: "what is wrangler?" | Answered in step 1 |

Group entries that lead to one change into one row. Then list **Needs your call**: comments that say something's wrong without saying what, unclear notes, conflicts. Leave those parts of the page as they are.

## 5. Snapshot, before touching the page

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/snapshot.mjs" <page path>
```

It copies the page to `versions/v<N>.html` and moves `notes.json` (or an older `notes-v<N>.json`) to `versions/v<N>.notes.json`. It then writes a fresh `notes.json` for v<N+1> carrying what the user ticked off, so their progress survives. It never overwrites a snapshot: run twice, it reports "already saved". Edit the page only after it exits 0. If it refuses, read its message and fix the cause; a snapshot is the user's only copy of what they reviewed, so it is never deleted or replaced to make the script pass.

## 6. Write the guides that were requested

For each plan phase with `kind: "guide"`:

1. Write the guide with `make-guide` at `plans/<plan>/guides/<guide-slug>/index.html` (the slug from the phase: `ph-cutover` → `cutover`, or a better name). Base it on the phase, the whole plan's context and the user's note. Set `<meta name="pm-parent" content="../../index.html">` and `<meta name="pm-parent-phase" content="<phase id>">`.
2. Register it: `registry.mjs add <guide path> --name … --goal … --next "You: start at <first step>"`.
3. In the plan's next version (step 7), add `data-guide="guides/<guide-slug>/index.html"` to the phase and mark it `data-changed="v<N+1>"`. If the phase described steps inline, move them into the guide and keep the phase to its goal and outcome.

Don't start a review server for each guide: the phase's card opens it.

## 7. Write v<N+1> into the live file

Edit the page in place (its path stays the same, so the user's URL keeps working):

- Make every change from the table, following the writing rules for the page's kind. Edited elements keep their `data-id`; new elements get new ids; ids of cut elements are not reused. If the page relied on ids assigned in the browser (`autoIds`), write explicit `data-id`s and `class="item"`s now, reusing the auto ids where the element survives.
- Mark every element you edited or added with `data-changed="v<N+1>"`: the page shows it with an "Updated in v<N+1>" chip. Remove `data-changed` attributes left from earlier rounds.
- **Answer every question where it was asked.** Add an `aside.explain` inside the step or entry it was about, right after the part it concerns:
  ```html
  <aside class="explain" data-q="what-is-wrangler" data-changed="v2">
    <span class="q">What is Wrangler?</span>
    <p>Cloudflare's command-line tool…</p>
  </aside>
  ```
  Answer the actual question at their level, in one or two short paragraphs. Add an example or the exact command where it helps. `.q` is their question, tidied, in their words. Answers stay in later versions.
- **Keep step and phase ids.** Ticked-off progress is stored against them. A new step gets a new id, and only remove steps that are truly gone.
- **Claude's steps and phases:** set `data-status` (`todo`, `doing`, `done`) to match what you've actually done, and the `<li data-status>` in a phase's `ul.tasks`.
- **Fill placeholders** with every value the user has given, in notes or in chat.
- **A plan keeps its three parts** (`WRITING.md`, "A plan's three parts"). If the plan you're revising has none (written before them), split it now: wrap its sections in Information, Steps and Questions, move the risks into Information and the decisions into Questions, and regroup the contents rail under the three part links. New content goes in Information, new phases in Steps, new decisions in Questions; when the last decision is answered, the Questions part says "Nothing for you to decide right now."
- Write **What changed in v<N+1>** as the first section of the page (on a plan, the first in Information), `section#changes`, replacing the previous version's: copy the shape of `${CLAUDE_PLUGIN_ROOT}/templates/changes-section.html`. One row per change, "You said" in the user's words (or "Make a guide", "More detail"), "What changed" with `§` links to the sections it touched; a "Decided" line for each answered decision; a first entry in the contents. Answered questions don't need a row: their answers sit where they were asked.
- **Refresh the page's style.** Replace its template `<style>` block (the first one, starting `:root {`) with the current one from `${CLAUDE_PLUGIN_ROOT}/templates/<kind>.html`, word for word, so design fixes reach pages written before them. Leave any second, page-specific `<style>` alone.
- Bump the version: `<meta name="plan-version" content="N+1">`, `<meta name="plan-date">` to today, and the slug's first two chips to `<span><Plan|Guide|Reference> v<N+1></span><span>Your v<N> notes applied</span>`.
- Add new decisions where the notes opened new questions.

**Check the page** you wrote (the new version, and every guide you wrote in step 6):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/check.mjs" <page path>
```

Fix every **error** and run it again until it prints `ok` or only warnings. An error means the page is broken or will lose the reader's notes: a second `<body>` or contents list (part of the template pasted twice), a tag left open, a repeated `data-id`, the template's example left in. Fix the **warnings** too, unless there's a reason (say which in your hand-over): they're `WRITING.md` rules, such as a section with no lede or an entry that runs long. Never hand over a page that fails the check.

## 8. Update the registry

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/registry.mjs" update <page path> --log "v<N+1>: <the main changes, in a few words>" --next "<what's next>"
```

This registers the page if it isn't registered yet. Then set the status for its kind (`registry.mjs --help` lists them):
- **plan**: `approved` if the notes approve it and nothing needs their call; `in-progress` once work has started; `done` when every phase is done; `blocked`, with `--next` saying what's awaited.
- **guide**: `not-started`, `in-progress` once they've ticked a step, `done` when every step is done, `blocked`.
- **reference**: `current` once the user has nothing left to change; otherwise leave it `reviewing`.

## 9. Report

Tell the user what changed (the table is enough), which questions you answered, which guides you wrote (with their paths), and anything that needs their call. Give the page's URL to reload. What they ticked off carried over. v<N> and its notes stay one click away in the version switcher. If the server isn't running, use `review-plan`.

Done when `check.mjs` passes on every page you wrote, every entry is accounted for in the table or in **Needs your call**, `versions/v<N>.html` and `versions/v<N>.notes.json` exist, the live page is v<N+1> with its `#changes` section and an answer beside every question, every requested guide exists, is registered and is linked from its phase, and the registry has a log line for v<N+1>.

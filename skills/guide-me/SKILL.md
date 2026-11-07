---
name: guide-me
description: Use when the user wants a step-by-step guide, walkthrough, runbook, setup instructions or "guide me through" something they will do themselves, especially a multi-step task with commands to copy, accounts to set up or clicks only they can make. Writes the guide as an HTML page the user follows and annotates in the browser: they tick steps off, ask questions anywhere and regenerate the guide to get them answered.
argument-hint: "[what to guide the user through]"
---

# Guide Me

A guide is a page a person **follows**. That's different from a plan, which a person reviews. The user works through it at their own pace and often learns as they go:

- **Mark done** on each step, with a progress bar in a bar fixed to the top of the page;
- **? Ask** on any step, or select text and choose **? Ask** or **＋ Note**;
- **Draw tools** (always on screen, in the top bar): arrows, boxes, circles, points and sticky notes, anywhere on the page;
- section notes and general notes.

Everything saves to `notes.json` beside the guide. When the user says **"regenerate my guide"**, the `regenerate-guide` skill answers every question inside the guide, at the step it was asked on. It keeps their progress and teaches whatever they didn't know.

There is no Keep / Change / Cut: the user isn't approving the guide, they're using it.

## 1. Work out the guide

Do the research first: read the code, check versions, look up the real commands and screens. A guide that's wrong at step 3 loses the reader. Then decide:

- **Who does each step.** The reader (`you`), Claude after a handoff (`claude`), or Claude prepares and the reader confirms (`both`). Anything that needs the reader's login, payment or judgement is theirs.
- **The order and the checkpoints.** Group steps into phases of 15–30 minutes. Put a "hand off to Claude" step wherever the reader passes results back, and give them the exact text to paste.
- **What they need to know already.** Assume a capable reader who may not know this tool. Explain briefly what an unfamiliar command does the first time it appears; the reader will **? Ask** about anything else.
- **Real values versus placeholders.** Use the real values you know: paths, project names, URLs. For values only the reader can supply (an account ID), write a visible placeholder like `<ACCOUNT_ID>`. The next regeneration fills it in once they've given it.

## 2. Pick the path

Use the path the user names. Otherwise use `guides/<slug>/index.html` from the project root, with a short kebab-case slug. Give each guide its own folder, because `notes.json` and `versions/` go beside it.

## 3. Write the page

Copy `${CLAUDE_PLUGIN_ROOT}/templates/guide.html` and replace every piece of example content. Keep its `<style>` block, extending it if you need to. Write no JavaScript: the review layer adds the controls and puts a **Copy** button on every `<pre>`.

| Mark | Put it on | Rules |
|---|---|---|
| `<meta name="pm-kind" content="guide">` | The head | Required: this turns on guide mode. |
| `.step[data-id]` | Every action the reader takes | One action per step, with a numbered `.num`, an `h4` title with a `.who` tag, a `.when` estimate and a body. Steps count toward progress. Ids are permanent and meaningful (`s3-export-dns`); progress is stored against them, so never renumber ids when steps move. |
| `.item[data-id]` | Anything else worth asking about | Prerequisites, troubleshooting rows (`<tr>`), reference tables. They get **? Ask** and a note, but no Mark done. |
| `<section class="sec" data-id>` | Each phase | Gets a section note. One per table-of-contents entry. |
| `<pre><code>` | Every command or text to paste | One block per thing to paste, with nothing in it the reader shouldn't run. Use `#` comments only where the shell ignores them. |
| `aside.explain[data-q]` | (On regeneration) | An answer to the reader's question; see `regenerate-guide`. |
| `section#glossary` | The end | Terms the reader asked about. Start it with the two or three terms they're most likely to trip on. |
| `.decision[data-decision]` | Choices only the reader can make | As in `make-plan`: radio options, `.rec` on your recommendation. Keep them few; a guide should mostly just say what to do. |
| `<meta name="plan-version">`, `<meta name="plan-date">`, the hero eyebrow | The head and hero | Start at `1`: `Guide v1 · <date>`. |
| The hero's "How to use this guide" line | The hero | Keep it as in the template. |

Write each step so the reader can act without scrolling back: what to do, the exact thing to click or paste, and what they should see when it worked. Put warnings (`.callout`) right before the action they're about, not at the end.

## 4. Start the review server

Run it in the background from the project root:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/review.mjs" guides/<slug>/index.html
```

It prints the URL and opens it. If `PLAN_MAKER_HOST` or `PLAN_MAKER_TRUST` is set in the environment, the user has chosen to reach the review server from other devices; give them the `net →` URL as well. Add `--host 0.0.0.0` only if they ask to follow the guide on another device.

## 5. Hand over

Tell the user, briefly:

- the URL and the guide's path;
- what it covers and roughly how long it takes, in two or three lines;
- how to use it: tick steps off; **? Ask** about anything, on a step or on selected text; the **draw tools** (top bar) to point at things; press **Regenerate guide** and say **"regenerate my guide"** to get answers.
- which step to start with.

Done when the guide follows the conventions, the server is running and the user has the URL.

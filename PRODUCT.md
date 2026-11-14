# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML and CSS with no build step. Each page is one self-contained HTML file: inline CSS, no script of its own, written by Claude from `templates/plan.html`, `templates/guide.html` or `templates/reference.html` (one shared style block). A Node server with no dependencies (`scripts/review.mjs`) injects the annotation layer (`lib/annotator.js`, `lib/annotator.css`) into each page. The hub (`lib/hub.html`) is a single page served by `scripts/hub.mjs`. System fonts only: pages must work offline and as one shared file, so no web fonts and no embedded font files.

## Users

People who install the plan-maker plugin for Claude Code from the marketplace. They are developers and technical leads who ask Claude for plans ("plan the billing migration"), guides ("guide me through moving DNS") or references ("document the build pipeline"). They read these pages in a browser beside their editor and terminal, often several pages at once across several repos, and sometimes on a phone or tablet over their local network. Plans are also shared as a single bundled file with teammates or clients, who review them without Claude or the server.

## Jobs

- **Review any page**: read it quickly, comment on anything (select text, or the buttons on a block), ask Claude questions, ask for more detail, answer the pick-one decisions and draw on the page. Then press Done for now and ask Claude to "process my notes", which writes the next version: notes applied, questions answered where they were asked, detail added, a "What changed" section.
- **Shape a plan**: judge the approach, phase by phase, and pick which phases need a guide (**Make a guide**).
- **Do your part**: follow a guide step by step, ticking each off, copying what to paste, checking what you should see. Claude's phases and steps show the status Claude sets. The user always knows what's waiting on them.
- **Look things up**: a reference, current with the code it describes, or saying plainly when it isn't.
- **Keep track of everything**: the hub lists every registered page across projects, grouped by project, a plan's guides under it. What's waiting on the user comes first.
- **Go back**: open any earlier version read-only, with the notes written on it.

## Product truth

- There are three kinds of page, for three jobs, on one engine and one design. A **plan** breaks a larger idea into a high-level sequence of phases; it says what and why, not how to click. A **guide** is primarily the reader's steps, optimized for a person doing them. A **reference** is for looking things up, with no progress. A plan points to guides (a phase done through a guide) and may point to references. Every kind is reviewed, versioned and listed the same way.
- What separates the reader's work from Claude's is the owner (You, Claude, or both) of each phase or step, and it must read at a glance everywhere: on the page, in the top bar and in the hub.
- Claude writes every page. The design must survive Claude filling the template with arbitrary content: long and short sections, tables, code, many or few decisions and steps.
- The annotation layer sits on top of any page, including plain HTML and plans made from older templates, and must stay legible over styles it doesn't control. Its classes start with `pm-`, and pages can recolour it through `--pm-*` tokens.
- Statuses, by kind: a plan is draft, reviewing, approved, in-progress, blocked, done or archived; a guide is draft, reviewing, not-started, in-progress, blocked, done or archived; a reference is draft, reviewing, current or archived (and out of date is worked out, not set).
- Everything runs locally. Nothing is sent anywhere unless the user starts a server with `--host`.

## Constraints

- Conventions are durable: `pm-kind`, `data-id`, `.item`, `.phase` and `.step` with `data-who`/`data-status`, `data-guide`, `pm-parent`, `pm-source`, `.decision`, `section#changes`, `aside.explain` and `data-changed`. The notes.json format only grows; older notes and older pages keep working.
- Responsive down to phone width. Light and dark follow the system setting.
- Accessibility: visible keyboard focus, sufficient contrast in both themes, reduced motion respected.

## Voice

Plain and direct, in sentence case. Say what a control does ("Mark done", "Process my notes"), not what the system is. No marketing tone; these are working documents.

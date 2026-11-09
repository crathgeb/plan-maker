# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML and CSS with no build step. Each plan is one self-contained HTML file: inline CSS, no script of its own, written by Claude from `templates/plan.html`. A Node server with no dependencies (`scripts/review.mjs`) injects the annotation layer (`lib/annotator.js`, `lib/annotator.css`) into each page. The hub (`lib/hub.html`) is a single page served by `scripts/hub.mjs`. System fonts only: pages must work offline and as one shared file, so no web fonts and no embedded font files.

## Users

People who install the plan-maker plugin for Claude Code from the marketplace. They are developers and technical leads who ask Claude for plans ("plan the billing migration") or walkthroughs ("guide me through moving DNS"). They read these pages in a browser beside their editor and terminal, often several pages at once across several repos, and sometimes on a phone or tablet over their local network. Plans are also shared as a single bundled file with teammates or clients, who review them without Claude or the server.

## Jobs

- **Review a plan**: read a long technical plan quickly, comment on anything (select text, or the Comment button on a block), ask Claude questions, answer the pick-one decisions and draw on the page. Then press Done for now and ask Claude to "process my notes", which writes the next version: notes applied, questions answered where they were asked, a "What changed" section.
- **Do your part**: every step in a plan belongs to the user ("You") or to Claude. The user ticks off their own steps, copies commands and asks questions on any step. Claude's steps show the status Claude sets. The user always knows what's waiting on them.
- **Keep track of everything**: the hub lists every registered plan across projects, grouped by project. What's waiting on the user comes first, and each plan shows its name, goal, description, status, both owners' progress, the next action and a progress log.
- **Go back**: open any earlier version read-only, with the notes written on it.

## Product truth

- There is one kind of page, a plan. What separates the reader's work from Claude's is the step owner (You, Claude, or both), and it must read at a glance everywhere: on the page, in the top bar and in the hub. A walkthrough is a plan whose steps are mostly the reader's.
- Claude writes every page. The design must survive Claude filling the template with arbitrary content: long and short sections, tables, code, many or few decisions and steps.
- The annotation layer sits on top of any page, including plain HTML and plans made from older templates, and must stay legible over styles it doesn't control. Its classes start with `pm-`, and pages can recolour it through `--pm-*` tokens.
- Statuses: draft, reviewing, approved, in-progress, blocked, done, archived.
- Everything runs locally. Nothing is sent anywhere unless the user starts a server with `--host`.

## Constraints

- Conventions are durable: `data-id`, `.item`, `.step` with `data-who`/`data-status`, `.decision`, `section#changes`, `aside.explain` and `data-changed`. The notes.json format only grows; older notes and older pages keep working.
- Responsive down to phone width. Light and dark follow the system setting.
- Accessibility: visible keyboard focus, sufficient contrast in both themes, reduced motion respected.

## Voice

Plain and direct, in sentence case. Say what a control does ("Mark done", "Process my notes"), not what the system is. No marketing tone; these are working documents.

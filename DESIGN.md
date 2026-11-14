---
version: alpha
name: plan-maker
description: Visual system for plan-maker's pages (plans, guides, references, the annotation layer, the hub). A calm, rounded document in the manner of Google Docs. The one strong signal is ownership: your phases and steps are blue cards, Claude's are gold cards.
colors:
  ground: "#F1F3F6"
  paper: "#FFFFFF"
  paper-2: "#F6F7F9"
  ink: "#1F2328"
  ink-2: "#57606A"
  muted: "#6E7781"
  line: "#D8DEE4"
  line-2: "#EAEEF2"
  you: "#7DA7D4"
  you-ink: "#516D8A"
  you-tint: "#F2F6FB"
  you-line: "#D3E1F0"
  claude: "#AA8546"
  claude-ink: "#6F572E"
  claude-tint: "#F7F3ED"
  claude-line: "#E2D6C0"
  on-fill: "#1F2328"
  good: "#1A7F37"
  warn: "#7D5300"
  highlight: "#FFF1B8"
  highlight-hot: "#FFE066"
  code-bg: "#1F2430"
  code-head: "#2A3040"
  code-ink: "#E6E9EF"
  code-muted: "#9AA3B2"
  dark-ground: "#0F1115"
  dark-paper: "#171A21"
  dark-paper-2: "#1D2129"
  dark-ink: "#E6E8EB"
  dark-ink-2: "#AAB1BB"
  dark-muted: "#8B94A0"
  dark-line: "#2C313A"
  dark-line-2: "#232830"
  dark-you: "#A4C1E1"
  dark-you-ink: "#B8CFE7"
  dark-you-tint: "#303C4C"
  dark-you-line: "#455A72"
  dark-claude: "#C4AA7E"
  dark-claude-ink: "#D0BC99"
  dark-claude-tint: "#3A342A"
  dark-claude-line: "#594A32"
  dark-on-fill: "#171A21"
  dark-good: "#4AC26B"
  dark-warn: "#D29922"
  dark-highlight: "#4A3F12"
  dark-highlight-hot: "#6B5A10"
  dark-code-bg: "#12151B"
  dark-code-head: "#1A1E26"
typography:
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'
  body: "16px / 1.65 sans 400"
  h1: "34px / 1.2 sans 650"
  h2: "24px / 1.3 sans 650"
  h3: "18px / 1.35 sans 600"
  h4: "16.5px / 1.4 sans 600"
  small: "13.5px / 1.45 sans"
  code: "13.5px / 1.65 mono"
radii:
  page: "12px"
  card: "10px"
  control: "8px"
  chip: "999px"
---

# plan-maker design system

## Overview

Every page reads like a well-kept shared doc: a white page with rounded corners on a soft grey desk, plain sans-serif text at a comfortable size, and generous space. There are three kinds of page, one design:

- **Plan**: a sequence of phases. Each phase is a card.
- **Guide**: steps to follow, mostly yours. Each step is a card.
- **Reference**: sections to look things up in. No cards, no timeline, no progress.

One thing is loud, and it's who owns each phase or step:

- **Yours** are blue cards with a "You" chip (a person icon).
- **Claude's** are gold cards with a "Claude" chip (a sparkle icon).

The same two colours carry ownership everywhere: the cards and their timeline nodes, the two segments of the progress bar, a guide's link on its phase, and the hub's "waiting on you" cards. Nothing else uses blue or gold. The kind of page is never shown in colour: it's a neutral chip with an icon (stacked bars for a plan, a staircase for a guide, a page for a reference) in the top bar and the hub.

Reviewing works like commenting in a doc. Select text to **Comment**, **Ask Claude** or ask for **More detail**, or use the same buttons on any block. There is no verdict system, so there's no Keep / Change / Cut. System fonts only: pages must work offline and as one shared file.

All three templates share one style block, word for word, and the hub wears it too. A change to the system is made once, in all three.

## Colors

- **Surfaces:** `paper` is the page; `ground` is the desk around it; `paper-2` is for quiet fills (callouts, table heads).
- **Text:** `ink` for text, `ink-2` for secondary text, `muted` for metadata (4.5:1 or better on paper).
- **Ownership:** `you-*` (blue) and `claude-*` (gold).
  - **Roles:** the base colour fills timeline nodes, the progress bar and the filled **Done** button. `-tint` is the card fill, `-line` the card's 1px border and inner rules, and `-ink` the text and icons for chips, buttons and owner labels.
  - **Derived from one base colour each**, so a future change of colour stays consistent:
    - **Light:** `-tint` is the base mixed 10% into `paper`; `-line` 34% into `paper`; `-ink` is 65% base, 35% black (contrast 4.5:1 or better on the tint).
    - **Dark:** the base is mixed 70% with white; `-tint` is the base 24% into `dark-paper`; `-line` 45%; `-ink` 55% base, 45% white.
  - **On-fill:** both base colours are light, so text and checks drawn *on* a solid base fill use `on-fill` (dark ink) in both themes, never white.
- **Comments:** `highlight` and `highlight-hot` mark commented text, a soft yellow as in Docs. It's neutral, so it never competes with ownership.
- **Code:** `code-*` for code blocks: a dark slate block with a lighter header bar, in both themes.
- **Status:** shown as a small dot (sidebar, status pill), always with the word nearby or in a tooltip, and kept out of the ownership colours:
  - **Draft:** hollow `muted`. **Reviewing:** solid `muted`.
  - **Approved:** hollow `good`. **In progress:** solid `good`.
  - **Blocked:** solid `warn`.
  - **Not started** (a guide): hollow `ink-2`. **Current** (a reference): solid `good`.
  - **Done and archived:** `line`.
- **Out of date** (a reference whose sources changed): a `warn` notice on the cover, tinted 10% into `paper`, with the word "Out of date." in `warn`.
- **No red, anywhere.** Not for status, errors, notices or counts. Errors and notices are neutral (`paper-2` with a `line` border).
- **Links** are plain `ink` with a `muted` underline that darkens on hover. Focus rings are 2px `ink-2`; text selection is `ink` at 14%. Neither uses an ownership colour.
- **Dark mode** uses the `dark-*` values. It's never pure black.

## Typography

- One family, the system sans, for everything except code.
- Body 16px/1.65 with a measure of about 70 characters. Headings in weight 600–650: h1 34, h2 24, h3 18, h4 16.5. Sentence case throughout.
- No eyebrow labels, no tracked capitals, no loose gutter numbers. Numbers appear only in two systems: the section badge before each h2 (1, 2, 3) and the timeline nodes on steps (2.1, 2.2 in a guide) and phases (1, 2, 3 across a plan's Steps part). Content is never numbered.
- Monospace only in code blocks and inline `code`. Tabular numerals in progress counts and tables.

## Layout

- **Pages:** like a Word document, each section is its own white page (max 860px, radius 12px, soft shadow, 48px/56px padding), stacked 24px apart on the `ground`. The hero is the cover page. "Page n" sits small in each page's bottom-right corner. On wide screens a contents list sits to the left. On phones the pages run nearly edge to edge (8px margin, radius 10px, 16px padding).
- **A plan's parts:** a plan's sections sit in parts: Information, Steps, then Questions (only while a decision is open) and the Decision log (once anything is decided). Each part opens on the desk, not on a page: a round white icon (an i, a staircase, a question mark, a checked page), the part's name at 22px and one line in `ink-2`, 32px above. The contents rail has no "Contents" title and no icons: it lists the parts in bold and their sections indented beneath; a part with one section shows only its heading. Under Steps, the rail lists every phase.
- **The rail scrolls on its own,** inside the window under the top bar, and opens scrolled to the next step.
- **Finished work folds.** In the rail, a group's done steps fold into one row ("✓ 4 done", or "All 4 done", with a chevron) that opens with a click. On the page, a section whose steps are all done keeps its heading and lede and folds the rest behind one line: a `good` check, "All 4 steps done", and "Show" on the right (a 1px `line-2` box on `paper`). Inside an unfinished section, a finished group of steps folds the same way (in line with the cards), and a finished phase folds to its title. Opening a fold shows everything in it; "Hide" folds it again. Following a link to a folded step opens its fold. Hidden steps keep their numbers.
- **A guide's rail** reads the same way: each section is a bold heading, and a section with steps lists them beneath it; no "Contents" title.
- **Where you are, in the rail:** each phase under Steps, and each step in a guide's rail, has a 14px marker in the gutter: a `line` ring to do, a half-filled `ink-2` ring when partly done, an `ink` ring and `ink` 600 text for the next one, a `good` check (and `muted` text) when done. Phases are numbered 1, 2, 3 across the Steps part. Guides and references have no parts. What goes in which part is in `WRITING.md`.
- **Sections:** h2 with a rounded number badge (34px, `paper-2`) before it, then a one-sentence lede (`.lede`, 18px, `ink-2`) saying what the section covers and why it's there. Every section has one, on every kind of page, so no section opens straight into its steps, phases or tables. In a plan, the lede also says whether the section describes what gets built or is the work itself.
- **Timeline:** only things to do are on it. Each step and phase is a numbered node (2.1, 2.2…) on a vertical line on the left: 34px circles on a 2px `line-2` line, with the cards indented 52px. Content (entries, lists, callouts, decisions, tables, definitions) sits flush, with no node and no number, on every kind of page, so explanation never reads as part of the sequence. A callout placed among steps lines up with the step cards. What counts as content and what as a step is in `WRITING.md`.
  - **Steps:** a node takes its owner's colour (tint fill, ring). It fills solid with a check when done, the line below a done node takes the owner's colour, and the next undone step (whoever owns it) gets a soft halo ring.
  - **The line** breaks between runs, e.g. across a phase heading.
- **Phases (plans):** each phase is its own card, 14px apart, a little roomier than a step card (radius 12px, 18px/20px padding). They sit on the timeline like steps.
- **Steps (guides):** grouped under a short heading (h3 plus when, aligned with the cards). Each step is its own card with 12px between cards, so steps never run together.
- **References:** having no steps, they have no timeline at all. The contents list is on the cover as well as in the side rail, because a reference is read by jumping.
- **The comment panel** sits on the right like the Docs comment sidebar, a column of rounded comment cards. It is closed until you comment or press Comments.
- **Hub:** a full-height sidebar (300px) on its own white surface: search, a type filter (All, Plans, Guides, References), "Waiting on you" and "Running servers" with their counts as plain numbers, then collapsible project groups (a chevron and the name, no count). A pin at the right of a project's heading (shown on hover, and always once pinned) moves it to the top; pinned projects come first, then a 36px gap, then the rest. An open project has 20px above it; collapsed ones stack 4px apart. Pins and collapsed groups are remembered in this browser. Each page is a two-line row: its kind icon, its name, and beneath, what's going on: what it wants from you ("Review the plan", "Your turn: Make a folder to work in") in `you-ink`, else its status in `muted` (`warn` when blocked). A small blue dot at the right marks a page waiting on you; there are no per-row counts. Every icon sits in one column and every dot in another; a plan's guides are indented so their icons sit under the plan's name, with no hairline. Done or archived pages are collapsed at the bottom. A button collapses it to a 56px rail. The main area shows "Waiting on you" as pages, or the selected plan itself, live, in a frame with nothing of the hub's above it. The hub never uses red.

## Elevation & Depth

- The page, cards that float (popover, menus, comment panel) and the hub's panels share one soft shadow: `0 1px 2px rgba(31,35,40,.06), 0 4px 16px rgba(31,35,40,.08)`.
- Step cards are flat: tint and border, no shadow.
- No hard offset shadows.

## Shapes

- Page and panels 12px, cards 10px, buttons and inputs 8px, chips and counts fully rounded.
- Icons are inline SVG at a 1.6px stroke: person (You), sparkle (Claude), comment bubble, check, copy.

## Components

- **Phase card (plan):** the owner chip before the title (h3), when in `muted`, a sentence or two, then **Done when …** in a `paper` inset. Claude's phases may list a short checklist: small gold rings, half-filled when in progress, filled with a check when done. The footer holds Mark done (yours) or the status (Claude's), and on hover **Comment**, **More detail** and **Make a guide**. A phase done through a guide shows the guide instead of Mark done: a blue-outlined link with the staircase icon, the guide's name, its progress ("3 of 7 steps done") and an arrow; tinted when the guide is done.
- **Step card (guide):** the owner chip (You or Claude, with its icon) inline before the title (h4), the time or need in `muted`, then the body. **You should see …** sits in a `paper` inset with the words in `good`; **If it fails …** in a `warn` inset tinted 8% into `paper`. A footer row, under a 1px `-line` rule, holds the actions:
  - **Your steps:** **Mark done**, a rounded checkbox button. Once done it fills with the base colour and a check in `on-fill`.
  - **Claude's steps:** the status Claude set (To do, In progress or Done), with an empty, half or check icon, and while it isn't done, a gold-outlined **Mark done** so the reader can close it themselves. Pressed, it fills gold and reads "Marked done by you", and the step counts as done everywhere until Claude writes the status into the page.
  - **Comment** and **More detail** sit at the footer's right.
  - **A done step** keeps its colours, and its chip icon becomes a check.
- **Comment, More detail, Make a guide:** quiet buttons on each block (a bubble, a list with a plus, a staircase). They show on hover or focus and always on touch screens. Once a block has a note, one button stays, saying what it is: "Your comment", "Your question", "More detail asked", "Guide requested", in the comment highlight.
- **Selection popover:** **Comment**, **Ask Claude** and **More detail**. The comment card has a switch between Comment, Question, More detail and (on a plan's phase) Make a guide.
- **What you need (guide):** on the cover, under a hairline, no box and no colour: "What you need" in 15px ink and a single-column list with small `muted` dots: time, logins, values, tools. One **Good to know** line may follow, with an info icon. The cover has no other boxes: a `.note-box` there is drawn as the same plain line.
- **Part of (guide):** above a guide's title, "← Part of **Plan name** › Phase", in `ink-2`, linking back.
- **Contents (reference):** on the cover, a `paper-2` box with a numbered list of sections in two columns. **Definitions** (`dl.defs`) are a two-column list ruled like entries; **signatures** (`.sig`) are mono on `paper-2`.
- **Code block:** a dark rounded block (radius 10px). A header bar shows the label (`data-label`, default "Code") on the left and **Copy** on the right; the code sits below in mono 13.5px. It scrolls sideways and never wraps commands.
- **Decision:** a question (h3) and its options as rounded radio rows, with no box around the whole. Claude's recommendation is a gold "Recommended" chip. Your choice gets a blue ring.
- **Claude's answer** (`aside.explain`): a gold-tinted rounded box headed "You asked: …".
- **What changed in vN:** a two-column table, "You said" against "What changed". Changed blocks get a small gold "Updated in vN" chip.
- **Top bar:** white, 1px bottom line. On the left, the kind chip (Plan, Guide, Reference: neutral, with its icon), the page's name and its status as a pill you can change, offering only that kind's statuses (saved to the registry through the review server). Then the draw tools, the version menu, save status, **Comments (n)** and **Done for now** (ink fill).
- **Progress:** on the cover page, under the lede: one bar for the whole page ("2 of 4 phases done" on a plan, "3 of 7 steps done" on a guide), filled with a blue segment for yours and a gold one for Claude's, with "You: 1 of 3" and "Claude: 2 of 4" beneath. The bar and **Next step** (or **Next phase**) share one outlined panel (1px `line`, radius 12px, no fill): the bar on top, Next step as the bottom row under a hairline, with "Next step" in `muted`, the owner chip (the only colour), the step's title and "Go to it ↓". Pressing it centres that step on screen, rings it once in its owner's colour, and moves focus to its Mark done. It disappears when everything is done. A reference has none. There is no "how to use this page" box.

## Do's and Don'ts

- **Do** make ownership readable from across the room: card colour, chip and icon together.
- **Do** keep the kinds apart by shape and words, never colour: a plan's phases, a guide's steps, a reference's flat sections, and the neutral kind chip.
- **Don't** put a list of the user's steps inside a plan's phase. That's a guide.
- **Do** keep everything else quiet: neutral greys, one weight of rule, plain text.
- **Don't** add verdict controls, loose gutter numbers or eyebrows. Numbering belongs to the section badges and the steps' timeline only.
- **Do** reuse the template's stylesheet for every other surface. The hub server injects it, so the hub can never drift from the plan page.
- **Don't** use blue or gold for anything that isn't ownership.
- **Don't** use a coloured left border as the owner marker. The card's tint and border do that job.
- **Don't** introduce a web font.
- **Don't** use red, or orange-red, anywhere.
- **Do** keep the hub's main area for the plan itself: a selected plan is its live page in a frame, with no hub bar above it. Anything you'd do from the hub (status, comments, progress) is done inside the plan.
- **Do** keep a plan's content, work and questions in their own parts. A reader following the plan should never meet explanation between two phases.
- **Do** keep the "how to use" teaching out of the page. Readers learn it by using it.

---
version: alpha
name: plan-maker
description: Visual system for plan-maker's pages (plans, the annotation layer, the hub). A calm, rounded document in the manner of Google Docs. The one strong signal is ownership: your steps are blue cards, Claude's are gold cards.
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

A plan reads like a well-kept shared doc: a white page with rounded corners on a soft grey desk, plain sans-serif text at a comfortable size, and generous space. One thing is loud, and it's who owns each step:

- **Your steps** are blue cards with a "You" chip (a person icon).
- **Claude's steps** are gold cards with a "Claude" chip (a sparkle icon).

The same two colours carry ownership everywhere: the step cards and their timeline nodes, the two segments of the progress bar, and the hub's "waiting on you" cards. Nothing else uses blue or gold.

Reviewing works like commenting in a doc. Select text to **Comment** or **Ask Claude**, or use the single **Comment** button on any block. There is no verdict system, so there's no Keep / Change / Cut. System fonts only: pages must work offline and as one shared file.

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
  - **Done and archived:** `line`.
- **No red, anywhere.** Not for status, errors, notices or counts. Errors and notices are neutral (`paper-2` with a `line` border).
- **Links** are plain `ink` with a `muted` underline that darkens on hover. Focus rings are 2px `ink-2`; text selection is `ink` at 14%. Neither uses an ownership colour.
- **Dark mode** uses the `dark-*` values. It's never pure black.

## Typography

- One family, the system sans, for everything except code.
- Body 16px/1.65 with a measure of about 70 characters. Headings in weight 600–650: h1 34, h2 24, h3 18, h4 16.5. Sentence case throughout.
- No eyebrow labels, no tracked capitals, no loose gutter numbers. Numbers appear only in two systems: the section badge before each h2 (1, 2, 3) and the timeline nodes inside a section (2.1, 2.2).
- Monospace only in code blocks and inline `code`. Tabular numerals in progress counts and tables.

## Layout

- **Pages:** like a Word document, each section is its own white page (max 860px, radius 12px, soft shadow, 48px/56px padding), stacked 24px apart on the `ground`. The hero is the cover page. "Page n" sits small in each page's bottom-right corner. On wide screens a contents list sits to the left. On phones the pages run nearly edge to edge (8px margin, radius 10px, 16px padding).
- **Sections:** h2 with a rounded number badge (34px, `paper-2`) before it.
- **Timeline:** inside a section, every entry, list item, callout, step and decision is a numbered node (2.1, 2.2…) on a vertical line on the left. Nodes are 34px circles on a 2px `line-2` line, with content indented 52px.
  - **Steps:** a node takes its owner's colour (tint fill, ring). It fills solid with a check when done, the line below a done node takes the owner's colour, and the next undone step (whoever owns it) gets a soft halo ring.
  - **The line** breaks between runs, e.g. across a phase heading.
- **Steps:** grouped under a phase heading (h3 plus when, aligned with the cards). Each step is its own card with 12px between cards, so steps never run together.
- **The comment panel** sits on the right like the Docs comment sidebar, a column of rounded comment cards. It is closed until you comment or press Comments.
- **Hub:** a full-height sidebar on its own white surface: search, "Waiting on you", then collapsible project groups with one line per plan (status dot, name, a count when it waits on you), and done or archived plans collapsed at the bottom. A button collapses it to a 56px rail. The main area shows "Waiting on you" as pages, or the selected plan itself, live, in a frame with nothing of the hub's above it. The hub never uses red.

## Elevation & Depth

- The page, cards that float (popover, menus, comment panel) and the hub's panels share one soft shadow: `0 1px 2px rgba(31,35,40,.06), 0 4px 16px rgba(31,35,40,.08)`.
- Step cards are flat: tint and border, no shadow.
- No hard offset shadows.

## Shapes

- Page and panels 12px, cards 10px, buttons and inputs 8px, chips and counts fully rounded.
- Icons are inline SVG at a 1.6px stroke: person (You), sparkle (Claude), comment bubble, check, copy.

## Components

- **Step card:** the owner chip (You or Claude, with its icon) inline before the title (h4), the time or need in `muted`, then the body. A footer row, under a 1px `-line` rule, holds the actions:
  - **Your steps:** **Mark done**, a rounded checkbox button. Once done it fills with the base colour and a check in `on-fill`.
  - **Claude's steps:** the status Claude set (To do, In progress or Done), with an empty, half or check icon. The reader can't change it.
  - **Comment** sits at the footer's right.
  - **A done step** keeps its colours, and its chip icon becomes a check.
- **Comment:** one quiet button per block ("Comment" with a bubble icon). It shows on hover or focus, always shows on touch screens, and always shows once the block has a comment ("1 comment").
- **Selection popover:** **Comment** and **Ask Claude**. A question is a comment flagged as a question, and the comment card has a Comment / Question switch.
- **Code block:** a dark rounded block (radius 10px). A header bar shows the label (`data-label`, default "Code") on the left and **Copy** on the right; the code sits below in mono 13.5px. It scrolls sideways and never wraps commands.
- **Decision:** a question (h3) and its options as rounded radio rows, with no box around the whole. Claude's recommendation is a gold "Recommended" chip. Your choice gets a blue ring.
- **Claude's answer** (`aside.explain`): a gold-tinted rounded box headed "You asked: …".
- **What changed in vN:** a two-column table, "You said" against "What changed". Changed blocks get a small gold "Updated in vN" chip.
- **Top bar:** white, 1px bottom line. On the left, the plan's name and its status as a pill you can change (saved to the registry through the review server). Then the draw tools, the version menu, save status, **Comments (n)** and **Done for now** (ink fill).
- **Progress:** on the cover page, under the lede: one bar for the whole plan ("3 of 7 steps done"), filled with a blue segment for your done steps and a gold one for Claude's, with "You: 1 of 3" and "Claude: 2 of 4" beneath. There is no "how to use this plan" box.

## Do's and Don'ts

- **Do** make ownership readable from across the room: card colour, chip and icon together.
- **Do** keep everything else quiet: neutral greys, one weight of rule, plain text.
- **Don't** add verdict controls, loose gutter numbers or eyebrows. Numbering belongs to the section badges and the timeline only.
- **Do** reuse the template's stylesheet for every other surface. The hub server injects it, so the hub can never drift from the plan page.
- **Don't** use blue or gold for anything that isn't ownership.
- **Don't** use a coloured left border as the owner marker. The card's tint and border do that job.
- **Don't** introduce a web font.
- **Don't** use red, or orange-red, anywhere.
- **Do** keep the hub's main area for the plan itself: a selected plan is its live page in a frame, with no hub bar above it. Anything you'd do from the hub (status, comments, progress) is done inside the plan.
- **Do** keep the "how to use" teaching out of the page. Readers learn it by using it.

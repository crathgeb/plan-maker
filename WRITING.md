# Writing a plan-maker page

The rules every page follows: plans, guides and references alike. `make-plan`, `make-guide`, `make-reference` and `process-notes` read this before they write. `DESIGN.md` says how the page looks; this says what goes on it. `scripts/check.mjs` checks a written page against both: the structure, the template's example left in, and the rules here it can test (ledes, owners on steps, entries that run long, headings numbered by hand).

## Two kinds of block: content and steps

Everything on a page is one or the other, and the reader must always be able to tell which at a glance.

| | **Steps** (and a plan's **phases**) | **Content** |
|---|---|---|
| What it is | Something someone has to do | Something to understand: what, why, how it works, what we found |
| Looks like | A card coloured by its owner, numbered on a line (2.1, 2.2), with **Mark done** or Claude's status | Flush on the page: no number, no line, no owner, no card colour |
| Markup | `.step` in `.steps`, `.phase` in `.phases` | `.entry`, `ul.tight`, a table, `dl.defs`, a paragraph, `.note-box` |
| Heading | The action, verb first: "Add the CNAME record" | The point, as a statement: "Agents use keys without ever seeing them" |

- **Only steps and phases are numbered.** Never number content, and never imitate a step for it (no "1." in a heading, no owner chip, no blue or gold).
- **Never mix the two in one block.** If an explanation ends in "so now run…", the run is a step of its own. If a step needs background, give it one sentence inside the step, or put the background in a content section before the steps.
- **Content comes before the steps that need it.** A section of explanation, then a section of steps. Each section is one or the other.
- **In a plan,** a content section that describes what gets built says so in its lede and names the phase that builds it. See [Ledes](#ledes).

## A plan's three parts: Information, Steps, Questions

Every plan is split into three parts, always all three, in this order. The contents rail lists each part's sections under its heading, so the reader always knows which kind of thing they're looking at, and can go straight to the work or straight to what's waiting on them.

| Part | Holds | Never holds |
|---|---|---|
| **Information** | Everything to understand: the short version, where things stand, the options compared, the design (how it works, what it looks like), **the risks**, and What changed in vN (first) | Phases, steps, decisions |
| **Steps** | The phases, in order, and nothing else. They're numbered 1, 2, 3 across the part | Explanation: a phase that needs background gets one sentence, or a pointer to the section in Information |
| **Questions** | The decisions only the user can make (`.decision`) | Anything already decided. When nothing is open, the part says "Nothing for you to decide right now." with no section |

- **Each part opens with its heading** (`div.part-h`): the part's name and one line on what's in it. Keep the template's lines unless the plan needs its own.
- **Risks are information**, never their own part or a step. A mitigation that's real work is a phase (or a task in one) in Steps; the risk names it.
- **A question that came up in a phase** goes to Questions, and the phase says "Waits on the decision about…" in a sentence.
- **Claude's answers** (`aside.explain`) stay where the question was asked, in whichever part that is.
- Guides and references don't have parts: a guide is mostly steps already, and a reference is all content.

## Ledes

Every section opens with a one-sentence lede (`<p class="lede">` right after its `<h2>`): what the section covers and why it's there. Never open a section straight into its steps, entries or table.

- A content section's lede says what the reader will learn: "What SnackVault is, what's built, and what today's run proves."
- A steps section's lede says what the steps get done and who does them: "The two DNS records that point the domain at the new site. Claude prepares them; you add them."
- In a plan, a design section's lede says it's the design and names the phase: "What the finished hub shows. The Hub phase builds it."

## Writing content clearly and concisely

Assume the reader skims. Each block should be understood from its heading alone, with the body as backup.

1. **Heading states the point.** A full statement a skimmer could stop at ("All of it is built; it has only run in test mode"), not a topic ("Status").
2. **Body: two sentences at most**, about 40 words. Give the one fact or reason that backs up the heading. Don't repeat the heading.
3. **One idea per block.** Two ideas means two blocks.
4. **Choose the lightest form that fits:**

   | You have | Use |
   |---|---|
   | One explanation | A paragraph |
   | A few parallel facts, each with a short name ("The problem", "What it does", "Where it stands") | `.entry` blocks: a label in `.k`, the point as `<h3>`, one or two sentences |
   | Three or more short parallel points | `ul.tight`: each item leads with its point in `<b>` |
   | Things compared on the same attributes | A table |
   | Terms, commands or fields to look up | `dl.defs` |
   | One caveat or warning the reader must not miss | `.note-box`, at most one per section |

5. **Lists inside an entry: three short items at most.** More than that and it's its own list or a table.
6. **Plain words.** Name things the way the reader does. Define a term the first time, or link it. No jargon you wouldn't say out loud.
7. **Concrete over abstract.** "247 automated tests pass", not "it's well tested". Real names, numbers and paths.
8. **Cut** anything the reader doesn't need to decide, do or understand the next step.

## Writing steps

- One action per step, with an `<h4>` that is that action, verb first.
- The exact thing to paste in its own `<pre data-label>` block; "You should see" and "If it fails" where they help (guides).
- Claude's steps are short hand-offs; the user's carry the detail.
- Every step and phase has an owner (`data-who`). Content never does.

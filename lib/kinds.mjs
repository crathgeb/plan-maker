// The three kinds of page plan-maker writes, and what each one's status can be.
// Every page is reviewed the same way; what differs is what it's for.
//
//   plan       breaks a larger idea into a high-level sequence of phases; links to guides
//   guide      gets a person through one task: mostly their steps, written to be followed
//   reference  explains a system so people can look things up: no steps, no progress
//
// A page declares its kind with <meta name="pm-kind" content="plan|guide|reference">.
// A page without one is a plan (plans written before kinds existed, and plain HTML).

export const KINDS = ['plan', 'guide', 'reference'];

export const STATUSES_BY_KIND = {
  plan: ['draft', 'reviewing', 'approved', 'in-progress', 'blocked', 'done', 'archived'],
  guide: ['draft', 'reviewing', 'not-started', 'in-progress', 'blocked', 'done', 'archived'],
  reference: ['draft', 'reviewing', 'current', 'archived'],
};
/** Every status any kind can have, in a sensible order. */
export const STATUSES = ['draft', 'reviewing', 'approved', 'not-started', 'in-progress', 'blocked', 'current', 'done', 'archived'];
/** Statuses that are finished with: they collapse into "Done and archived" and never wait on you. */
export const FINISHED = ['done', 'archived'];
export const ACTIVE = STATUSES.filter((s) => !FINISHED.includes(s));
export const DEFAULT_STATUS = { plan: 'reviewing', guide: 'not-started', reference: 'reviewing' };

export const LABELS = {
  draft: 'Draft', reviewing: 'Reviewing', approved: 'Approved', 'not-started': 'Not started', 'in-progress': 'In progress',
  blocked: 'Blocked', current: 'Current', done: 'Done', archived: 'Archived',
};
export const KIND_LABELS = { plan: 'Plan', guide: 'Guide', reference: 'Reference' };

const metaRe = (name) => new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([^"']*)["']`, 'i');
export const readMeta = (html, name) => html.match(metaRe(name))?.[1] ?? null;

/** The page's kind: its pm-kind meta, else plan. */
export function readKind(html) {
  const k = (readMeta(html, 'pm-kind') || '').trim().toLowerCase();
  return KINDS.includes(k) ? k : 'plan';
}

export const statusesFor = (kind) => STATUSES_BY_KIND[kind] || STATUSES_BY_KIND.plan;

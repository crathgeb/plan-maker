// guide-me mode and drawings, end to end in Chrome.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { launch, newPage, open, planCopy, readNotes, repo, selectText, startServer, waitForNotes } from './helpers.mjs';

let browser;
const errors = [];
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

/** Drag on the page with a drawing tool, from one block's point to another's (fractions of each block's box). */
async function draw(page, shape, from, to = from) {
  await page.click(`#pm-rail button[data-shape="${shape}"]`);
  const at = async ([id, fx, fy]) => {
    const el = page.locator(`[data-id="${id}"]`);
    await el.scrollIntoViewIfNeeded();
    const b = await el.boundingBox();
    return [b.x + b.width * fx, b.y + b.height * fy];
  };
  const [x1, y1] = await at(from);
  const [x2, y2] = await at(to);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 });
  await page.mouse.move(x2, y2, { steps: 4 });
  await page.mouse.up();
}

describe('guide template through the review server', () => {
  let server, files, page;
  before(async () => {
    files = planCopy(join(repo, 'templates/guide.html'));
    server = await startServer(files.plan);
    page = await newPage(browser, errors);
    await open(page, server.url);
  });
  after(() => server?.stop());

  test('steps get Mark done and Ask, never Keep / Change / Cut', async () => {
    assert.equal(await page.locator('.pm-v').count(), 0);
    assert.equal(await page.locator('[data-id="s1-install"] .pm-done-btn').count(), 1);
    assert.equal(await page.locator('[data-id="s1-install"] .pm-ask-btn').count(), 1);
    // items that aren't steps can be asked about but not ticked off
    assert.equal(await page.locator('[data-id="pre-node"] .pm-ask-btn').count(), 1);
    assert.equal(await page.locator('[data-id="pre-node"] .pm-done-btn').count(), 0);
    assert.equal((await page.locator('#pm-done').textContent()).trim(), 'Regenerate guide');
  });

  test('marking steps done saves progress and moves the progress bar', async () => {
    assert.equal(await page.locator('.pm-prog-txt b').textContent(), '0/3');
    await page.click('[data-id="s1-install"] .pm-done-btn');
    await page.click('[data-id="s2-build"] .pm-done-btn');
    const notes = await waitForNotes(files.notes, (n) => n.steps?.['s2-build']?.done);
    assert.equal(notes.kind, 'guide');
    assert.equal(notes.steps['s1-install'].done, true);
    assert.equal(await page.locator('.pm-prog-txt b').textContent(), '2/3');
    assert.match(await page.locator('.pm-prog-fill').getAttribute('style'), /width: 67%/);
    assert.equal(await page.locator('[data-id="s1-install"]').evaluate((n) => n.classList.contains('pm-step-done')), true);
    // undo
    await page.click('[data-id="s2-build"] .pm-done-btn');
    await waitForNotes(files.notes, (n) => !n.steps['s2-build']);
    assert.equal(await page.locator('.pm-prog-txt b').textContent(), '1/3');
  });

  test('? Ask on a step saves a question', async () => {
    await page.click('[data-id="s1-install"] .pm-ask-btn');
    await page.keyboard.type('What is example-cli?');
    const notes = await waitForNotes(files.notes, (n) => n.items?.['s1-install']?.note === 'What is example-cli?');
    assert.equal(notes.items['s1-install'].kind, 'question');
    assert.equal(notes.items['s1-install'].verdict, null);
  });

  test('selected text offers ? Ask and ＋ Note', async () => {
    await selectText(page, 's2-build', 0, 13); // "npm run build"
    await page.click('#pm-pop button[data-kind="question"]');
    await page.keyboard.type('Why build first?');
    let notes = await waitForNotes(files.notes, (n) => n.highlights?.some((h) => h.note === 'Why build first?'));
    assert.equal(notes.highlights.find((h) => h.note === 'Why build first?').kind, 'question');
    await selectText(page, 's3-deploy', 0, 14);
    await page.click('#pm-pop button[data-kind="note"]');
    await page.keyboard.type('Did this on Friday');
    notes = await waitForNotes(files.notes, (n) => n.highlights?.some((h) => h.note === 'Did this on Friday'));
    assert.equal(notes.highlights.find((h) => h.note === 'Did this on Friday').kind, 'note');
  });

  test('a note can be switched between question and note', async () => {
    const box = page.locator('.pm-note[data-key="i:s1-install"]');
    await box.locator('.pm-kinds button[data-k="note"]').click();
    await waitForNotes(files.notes, (n) => n.items['s1-install'].kind === 'note');
    await box.locator('.pm-kinds button[data-k="question"]').click();
    await waitForNotes(files.notes, (n) => n.items['s1-install'].kind === 'question');
  });

  test('code blocks get a copy button that copies only the code', async () => {
    assert.equal(await page.locator('pre .pm-copy').count(), await page.locator('main pre').count());
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(server.url).origin });
    await page.locator('[data-id="s2-build"] .pm-copy').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'npm run build');
  });

  test('progress survives a reload', async () => {
    await page.reload();
    await page.waitForSelector('html[data-pm-ready]');
    assert.equal(await page.locator('.pm-prog-txt b').textContent(), '1/3');
    assert.equal(await page.locator('[data-id="s1-install"] .pm-done-btn').textContent(), '✓ Done');
  });

  test('regenerating keeps progress: snapshot carries done steps into v2', async () => {
    await waitForNotes(files.notes, (n) => n.steps?.['s1-install']?.done);
    const r = spawnSync(process.execPath, [join(repo, 'scripts/snapshot.mjs'), files.plan], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /carried 1 done step/);
    assert.ok(existsSync(join(files.dir, 'versions/v1.notes.json')));
    const carried = readNotes(files.notes);
    assert.equal(carried.planVersion, '2');
    assert.equal(carried.steps['s1-install'].done, true);
    assert.deepEqual(carried.highlights, []);
    assert.deepEqual(carried.items, {});
  });
});

describe('drawings on a plan', () => {
  let server, files, page;
  before(async () => {
    files = planCopy(join(repo, 'templates/plan.html'));
    server = await startServer(files.plan);
    page = await newPage(browser, errors);
    await open(page, server.url);
  });
  after(() => server?.stop());

  test('a box drawn over a card is anchored to that card and saved', async () => {
    await draw(page, 'box', ['sum-goal', 0.1, 0.1], ['sum-goal', 0.9, 0.8]);
    await page.keyboard.type('This is the real goal');
    const notes = await waitForNotes(files.notes, (n) => n.drawings?.[0]?.note === 'This is the real goal');
    const d = notes.drawings[0];
    assert.equal(d.shape, 'box');
    assert.equal(d.blockId, 'sum-goal');
    assert.ok(Math.abs(d.x1 - 0.1) < 0.05 && Math.abs(d.y2 - 0.8) < 0.05, JSON.stringify(d));
    assert.match(d.where, /Docs ship with the code/);
    assert.equal(await page.locator('#pm-shapes .pm-shape').count(), 1);
  });

  test('arrows, circles, points and sticky notes save too', async () => {
    await draw(page, 'arrow', ['ph-1', 0.9, 0.2], ['ph-2', 0.5, 0.5]);
    await draw(page, 'circle', ['risk-seo', 0.05, 0.1], ['risk-seo', 0.5, 0.9]);
    await draw(page, 'point', ['ap-preview', 0.5, 0.5]);
    await draw(page, 'note', ['ctx-time', 0.8, 0.3]);
    await page.keyboard.type('Ask the writer about this');
    const notes = await waitForNotes(files.notes, (n) => n.drawings?.length === 5 && n.drawings[4].note);
    assert.deepEqual(notes.drawings.map((d) => d.shape), ['box', 'arrow', 'circle', 'point', 'note']);
    assert.deepEqual(notes.drawings.map((d) => d.n), [1, 2, 3, 4, 5]);
    assert.equal(notes.drawings[1].blockId, 'ph-1');
    assert.equal(await page.locator('.pm-pin-note .pm-pin-text').textContent(), 'Ask the writer about this');
  });

  test('a click with a drag tool draws nothing; Escape cancels', async () => {
    await draw(page, 'box', ['ap-source', 0.5, 0.5]);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#pm-overlay').isVisible(), false);
    assert.equal(readNotes(files.notes).drawings.length, 5);
  });

  test('drawings follow their block when the layout changes', async () => {
    const box = () => page.locator('#pm-shapes [data-d] rect').first().evaluate((r) => +r.getAttribute('x'));
    const card = () => page.locator('[data-id="sum-goal"]').evaluate((n) => n.getBoundingClientRect().left + scrollX);
    const before = (await box()) - (await card());
    await page.setViewportSize({ width: 820, height: 900 });
    await page.waitForTimeout(150);
    const after = (await box()) - (await card());
    assert.ok(Math.abs(after - before) < 40, `offset within the card stays put: ${before} → ${after}`);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('drawings come back after a reload and can be deleted from the panel', async () => {
    await page.reload();
    await page.waitForSelector('html[data-pm-ready]');
    assert.equal(await page.locator('#pm-shapes .pm-shape').count(), 3);
    assert.equal(await page.locator('#pm-pins .pm-pin').count(), 2);
    const first = readNotes(files.notes).drawings[0].id;
    await page.locator(`.pm-note[data-key="d:${first}"] .pm-del`).click();
    await waitForNotes(files.notes, (n) => n.drawings.length === 4);
    assert.equal(await page.locator('#pm-shapes .pm-shape').count(), 2);
  });

  test('phone width: no horizontal scroll with drawings on the page', async () => {
    const phone = await newPage(browser, errors, { width: 390, height: 844 });
    await open(phone, server.url);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0);
    await phone.close();
  });
});

describe('no unexpected console errors (guide and drawings)', () => {
  test('none', () => {
    assert.deepEqual(errors, []);
  });
});

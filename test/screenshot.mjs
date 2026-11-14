// Regenerates the README's screenshots from the templates:
//   docs/screenshot.png  the plan mid-review: a highlighted phrase, a block's comment, the panel
//   docs/phases.png      the plan's phases: Claude's checklist, your phase, one done through a guide
//   docs/guide.png       the guide made from that phase, partway through, with its way back to the plan
//   docs/versions.png    v2 with "What changed" and the version switcher open
//   npm run screenshot [-- <extra-dir>]   (extra-dir also gets dark, phone and reference shots)
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { launch, newPage, open, planCopy, repo, selectText, startServer } from './helpers.mjs';

const extra = process.argv[2];
const files = planCopy(join(repo, 'templates/plan.html'));
// The guide the switch-over phase links to, two steps in.
const guide = join(files.dir, 'guides/dns-cutover/index.html');
mkdirSync(dirname(guide), { recursive: true });
copyFileSync(join(repo, 'templates/guide.html'), guide);
writeFileSync(join(dirname(guide), 'notes.json'), JSON.stringify({ version: 1, planVersion: '1', steps: { 'g-open-dns': { done: true }, 'g-cname': { done: true } } }));
const server = await startServer(files.plan);
const guideServer = await startServer(guide);
const browser = await launch();
const errors = [];
const shot = async (page, file) => {
  await page.screenshot({ path: join(repo, 'docs', file) });
  console.log(`wrote docs/${file}`);
};
const scrollTo = (page, sel) => page.evaluate((s) => {
  document.querySelector(s).scrollIntoView();
  window.scrollBy(0, -20);
}, sel);

/** v1 → v2, the way process-notes does: a changed phase, a "What changed" section. */
function writeV2(plan) {
  const html = readFileSync(plan, 'utf8')
    .replace('<meta name="plan-version" content="1">', '<meta name="plan-version" content="2">')
    .replace('<meta name="plan-date" content="2026-11-09">', '<meta name="plan-date" content="2026-11-10">')
    .replace('<span>Plan v1</span><span>For review</span><span>9 Nov 2026</span>', '<span>Plan v2</span><span>Your v1 notes applied</span><span>10 Nov 2026</span>')
    .replace('<div class="when">Week 2 · about 2 hours</div>', '<div class="when">Weeks 2 to 3 · about 2 hours</div>')
    .replace('data-id="ph-review" data-who="you"', 'data-id="ph-review" data-changed="v2" data-who="you"')
    .replace('  <a href="#summary">Summary</a>', '  <a href="#changes">What changed in v2</a>\n  <a href="#summary">Summary</a>')
    .replace('<section class="sec" id="summary"', `<section class="sec" id="changes" data-id="changes">
  <h2>What changed in v2</h2>
  <div class="table-wrap"><table><thead><tr><th>You said</th><th>What changed</th></tr></thead><tbody>
    <tr class="item" data-id="chg-v2-scope"><td>“Include the API reference too”</td><td>The API reference is in scope, and has its own reference page. <a href="#summary">§1</a></td></tr>
    <tr class="item" data-id="chg-v2-time"><td>“Plan for four weeks with buffer”</td><td>The review runs across weeks 2 and 3. <a href="#phases">§4</a></td></tr>
  </tbody></table></div>
  <ul class="decided"><li><b>Decided:</b> Which generator? → <b>Astro</b>. <a href="#approach">§3</a></li></ul>
</section>

<section class="sec" id="summary"`);
  writeFileSync(plan, html);
}

try {
  const page = await newPage(browser, errors, { width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page, server.url);
  await selectText(page, 'sum-scope', 25, 39); // "About 60 pages"
  await page.click('#pm-pop button[data-kind="note"]');
  await page.keyboard.type('Include the API reference too');
  await page.hover('[data-id="sum-cost"]');
  await page.click('[data-id="sum-cost"] .pm-note-btn');
  await page.keyboard.type('Plan for four weeks with buffer');
  await page.fill('#pm-general', 'Direction looks right. Tighten the timeline before we start.');
  await page.click('body', { position: { x: 5, y: 5 } });
  await scrollTo(page, '#summary');
  await page.waitForTimeout(600);
  await shot(page, 'screenshot.png');

  await page.click('#pm-toggle'); // close the panel
  await page.hover('[data-id="ph-review"]');
  await page.click('[data-id="ph-review"] .pm-guide-btn');
  await page.click('#pm-toggle');
  await scrollTo(page, '[data-id="ph-scaffold"] .outcome');
  await page.mouse.move(5, 5);
  await page.waitForTimeout(600);
  await shot(page, 'phases.png');

  const g = await newPage(browser, errors, { width: 1440, height: 900 });
  await g.emulateMedia({ colorScheme: 'light' });
  await open(g, guideServer.url);
  await g.mouse.move(5, 5);
  await g.waitForTimeout(400);
  await shot(g, 'guide.png');

  // Revise to v2 the way process-notes does, then show the switcher.
  await page.waitForTimeout(500);
  execFileSync(process.execPath, [join(repo, 'scripts/snapshot.mjs'), files.plan]);
  writeV2(files.plan);
  const v2 = await newPage(browser, errors, { width: 1440, height: 900 });
  await v2.emulateMedia({ colorScheme: 'light' });
  await open(v2, server.url);
  await scrollTo(v2, '#changes');
  await v2.click('#pm-ver');
  await v2.waitForTimeout(600);
  await shot(v2, 'versions.png');

  if (extra) {
    mkdirSync(extra, { recursive: true });
    const dark = await newPage(browser, errors, { width: 1440, height: 900 });
    await dark.emulateMedia({ colorScheme: 'dark' });
    await open(dark, server.url);
    await dark.screenshot({ path: join(extra, 'dark.png') });
    await scrollTo(dark, '#phases');
    await dark.waitForTimeout(800);
    await dark.screenshot({ path: join(extra, 'dark-phases.png') });
    const phone = await newPage(browser, errors, { width: 390, height: 844 });
    await open(phone, guideServer.url);
    await phone.screenshot({ path: join(extra, 'phone-guide.png') });
    await scrollTo(phone, '[data-id="g-cname"]');
    await phone.waitForTimeout(800);
    await phone.screenshot({ path: join(extra, 'phone-step.png') });
    const refFiles = planCopy(join(repo, 'templates/reference.html'));
    const refServer = await startServer(refFiles.plan);
    const ref = await newPage(browser, errors, { width: 1440, height: 900 });
    await open(ref, refServer.url);
    await ref.screenshot({ path: join(extra, 'reference.png') });
    refServer.stop();
    console.log(`wrote extra shots to ${extra}`);
  }
  if (errors.length) console.error(errors.join('\n'));
} finally {
  await browser.close();
  server.stop();
  guideServer.stop();
}

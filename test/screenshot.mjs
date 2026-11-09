// Regenerates docs/screenshot.png (the template plan mid-review), docs/steps.png
// (your steps and Claude's, with both lanes) and docs/versions.png (v2 with the
// version switcher open).
//   npm run screenshot [-- <extra-dir>]   (extra-dir also gets dark and phone shots)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, newPage, open, planCopy, repo, selectText, startServer, writeV2 } from './helpers.mjs';

const extra = process.argv[2];
const files = planCopy(join(repo, 'templates/plan.html'));
// Claude has done some of its steps, as it would partway through.
writeFileSync(files.plan, readFileSync(files.plan, 'utf8')
  .replace('data-id="s2-scaffold" data-who="claude" data-status="todo"', 'data-id="s2-scaffold" data-who="claude" data-status="done"')
  .replace('data-id="s3-convert" data-who="claude" data-status="todo"', 'data-id="s3-convert" data-who="claude" data-status="doing"'));
const server = await startServer(files.plan);
const browser = await launch();
const errors = [];

try {
  const page = await newPage(browser, errors, { width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page, server.url);
  await selectText(page, 'sum-scope', 25, 39); // "About 60 pages"
  await page.click('#pm-pop button[data-kind="note"]');
  await page.keyboard.type('Include the API reference too');
  await page.click('[data-id="sum-cost"] .pm-note-btn');
  await page.keyboard.type('Plan for four weeks with buffer');
  await page.fill('#pm-general', 'Direction looks right. Tighten the timeline before we start.');
  await page.click('body', { position: { x: 5, y: 5 } });
  await page.evaluate(() => document.getElementById('summary').scrollIntoView());
  await page.evaluate(() => window.scrollBy(0, -20));
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(repo, 'docs/screenshot.png') });
  console.log('wrote docs/screenshot.png');

  await page.click('[data-id="s1-pages-project"] .pm-done-btn');
  await page.click('#pm-toggle'); // close the panel
  await page.evaluate(() => document.getElementById('rollout').scrollIntoView());
  await page.evaluate(() => window.scrollBy(0, -20));
  await page.mouse.move(5, 5);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(repo, 'docs/steps.png') });
  console.log('wrote docs/steps.png');

  // Revise to v2 the way process-plan-notes does, then show the switcher.
  await page.waitForTimeout(500);
  execFileSync(process.execPath, [join(repo, 'scripts/snapshot.mjs'), files.plan]);
  writeV2(files.plan);
  const v2 = await newPage(browser, errors, { width: 1440, height: 900 });
  await v2.emulateMedia({ colorScheme: 'light' });
  await open(v2, server.url);
  await v2.evaluate(() => document.getElementById('changes').scrollIntoView());
  await v2.evaluate(() => window.scrollBy(0, -20));
  await v2.click('#pm-ver');
  await v2.waitForTimeout(600);
  await v2.screenshot({ path: join(repo, 'docs/versions.png') });
  console.log('wrote docs/versions.png');

  if (extra) {
    mkdirSync(extra, { recursive: true });
    const v1 = await newPage(browser, errors, { width: 1440, height: 900 });
    await open(v1, server.url + 'versions/v1');
    await v1.evaluate(() => document.getElementById('summary').scrollIntoView());
    await v1.waitForTimeout(600);
    await v1.screenshot({ path: join(extra, 'v1-readonly.png') });
    await v1.evaluate(() => window.scrollTo(0, 0));
    await v1.waitForTimeout(600);
    await v1.screenshot({ path: join(extra, 'v1-top.png') });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(extra, 'top.png') });
    const dark = await newPage(browser, errors, { width: 1440, height: 900 });
    await dark.emulateMedia({ colorScheme: 'dark' });
    await open(dark, server.url);
    await dark.screenshot({ path: join(extra, 'dark.png') });
    await dark.evaluate(() => document.getElementById('decisions').scrollIntoView());
    await dark.waitForTimeout(800);
    await dark.screenshot({ path: join(extra, 'dark-decisions.png') });
    const phone = await newPage(browser, errors, { width: 390, height: 844 });
    await open(phone, server.url);
    await phone.screenshot({ path: join(extra, 'phone.png') });
    await phone.evaluate(() => document.getElementById('risks').scrollIntoView());
    await phone.waitForTimeout(800);
    await phone.screenshot({ path: join(extra, 'phone-risks.png') });
    await phone.click('#pm-toggle');
    await phone.waitForTimeout(300);
    await phone.screenshot({ path: join(extra, 'phone-panel.png') });
    console.log(`wrote extra shots to ${extra}`);
  }
  if (errors.length) console.error(errors.join('\n'));
} finally {
  await browser.close();
  server.stop();
}

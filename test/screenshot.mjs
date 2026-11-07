// Regenerates docs/screenshot.png: the template plan mid-review.
//   npm run screenshot [-- <extra-dir>]   (extra-dir also gets dark and phone shots)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, newPage, open, planCopy, repo, selectText, startServer } from './helpers.mjs';

const extra = process.argv[2];
const files = planCopy(join(repo, 'templates/plan.html'));
const server = await startServer(files.plan);
const browser = await launch();
const errors = [];

try {
  const page = await newPage(browser, errors, { width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page, server.url);
  await selectText(page, 'sum-scope', 25, 39); // "About 60 pages"
  await page.click('#pm-pop');
  await page.keyboard.type('Include the API reference too');
  await page.click('[data-id="sum-goal"] .pm-v[data-v="keep"]');
  await page.click('[data-id="sum-cost"] .pm-v[data-v="change"]');
  await page.click('[data-id="sum-cost"] .pm-note-btn');
  await page.keyboard.type('Plan for four weeks with buffer');
  await page.click('[data-id="sum-nongoal"] .pm-v[data-v="cut"]');
  await page.fill('#pm-general', 'Direction looks right. Tighten the timeline before we start.');
  await page.click('body', { position: { x: 5, y: 5 } });
  await page.evaluate(() => document.getElementById('summary').scrollIntoView());
  await page.evaluate(() => window.scrollBy(0, -20));
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(repo, 'docs/screenshot.png') });
  console.log('wrote docs/screenshot.png');

  if (extra) {
    mkdirSync(extra, { recursive: true });
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

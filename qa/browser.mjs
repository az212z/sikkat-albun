import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, webkit } from 'playwright';
import axe from 'axe-core';

const url = process.env.PILOT_URL ?? 'http://127.0.0.1:48732';
const folder = resolve(process.env.PILOT_EVIDENCE ?? '../../evidence');
await mkdir(folder, { recursive: true });
const sizes = [[360, 800], [390, 844], [430, 932], [768, 1024], [1024, 900], [1440, 900], [1920, 1080]];
const events = [];
const report = { url, engines: [], results: [] };

function observe(page) {
  page.on('pageerror', error => events.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) events.push(`HTTP ${response.status()} ${response.url()}`);
  });
}

async function checkPage(page, engine, width, capture = false) {
  observe(page);
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready.then(() => document.querySelector('img').decode()));
  const checks = await page.evaluate(() => ({
    rtl: document.documentElement.dir === 'rtl',
    overflow: document.documentElement.scrollWidth > innerWidth,
    image: document.querySelector('img').naturalWidth,
    font: document.fonts.check('700 30px Sikka', 'القهوة'),
    brokenAnchors: [...document.querySelectorAll('a[href^="#"]')]
      .filter(anchor => !document.querySelector(anchor.getAttribute('href'))).map(anchor => anchor.href),
    horizontalOverflow: [...document.querySelectorAll('h1,h2,h3,select')]
      .filter(item => item.scrollWidth > item.clientWidth + 2).map(item => item.textContent),
  }));
  assert.equal(checks.rtl, true);
  assert.equal(checks.overflow, false);
  assert.equal(checks.font, true);
  assert.ok(checks.image > 0);
  assert.deepEqual(checks.brokenAnchors, []);
  assert.deepEqual(checks.horizontalOverflow, []);
  if (capture) await page.screenshot({ path: join(folder, `screen-${width}.png`), fullPage: true });
  if (engine === 'Chrome') await page.keyboard.press('Tab');
  else await page.locator('.skip').focus();
  assert.equal(await page.locator(':focus').textContent(), 'تخطَّ إلى المحتوى');
  await page.keyboard.press('Enter');
  assert.equal(new URL(page.url()).hash, '#main');

  await page.getByRole('link', { name: 'اختر توت وياسمين' }).click();
  assert.equal(new URL(page.url()).hash, '#plan');
  assert.equal(await page.locator(':focus').getAttribute('id'), 'plan-title');
  assert.equal(await page.locator('[name="flavor"]').inputValue(), 'bright');
  await page.locator('[name="weight"]').selectOption('500');
  await page.locator('[name="grind"]').selectOption('filter');
  await page.locator('[name="cadence"]').selectOption('14');
  assert.match(await page.locator('#price').textContent(), /١٠٩/);
  assert.match(await page.locator('#selection').textContent(), /توت وياسمين.*طحن للترشيح.*٥٠٠ غ.*أسبوعين/);
  await page.locator('summary').first().click();
  assert.equal(await page.locator('details').first().getAttribute('open'), '');
  await page.locator('summary').first().click();
  assert.equal(await page.locator('details').first().getAttribute('open'), null);

  await page.evaluate(axe.source);
  const scan = await page.evaluate(() => window.axe.run({
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  }));
  assert.deepEqual(scan.violations.map(({ id, nodes }) => [id, nodes.map(node => node.target)]), []);
  report.results.push({ engine, width, checks, axe: { violations: scan.violations.length, passes: scan.passes.length, manual: scan.incomplete.map(item => item.id) } });
}

async function checkNavigation(page) {
  await page.goto(url);
  for (const link of await page.locator('a[href^="#"]:not(.skip):visible').all()) {
    const hash = await link.getAttribute('href');
    const flavor = await link.getAttribute('data-flavor');
    await link.click();
    assert.equal(new URL(page.url()).hash, hash);
    if (flavor) assert.equal(await page.locator('[name="flavor"]').inputValue(), flavor);
  }
  for (const disclosure of await page.locator('summary').all()) {
    await disclosure.click();
    assert.equal(await disclosure.locator('..').getAttribute('open'), '');
    await disclosure.click();
    assert.equal(await disclosure.locator('..').getAttribute('open'), null);
  }
}

async function checkSave(page) {
  observe(page);
  await page.goto(url);
  const endpoint = '**/api/drafts';
  const button = page.getByRole('button', { name: 'احفظ المسودة' });
  await page.route(endpoint, route => route.abort());
  await button.click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('تعذّر'));
  assert.equal(await page.locator('[name="flavor"]').inputValue(), 'smooth');
  assert.equal(await page.locator(':focus').textContent(), 'احفظ المسودة');
  await page.unroute(endpoint);
  const first = page.waitForResponse(response => response.url().endsWith('/api/drafts'));
  await button.click();
  assert.equal((await first).status(), 201);
  await page.waitForFunction(() => Boolean(document.querySelector('#status bdi')));
  const reference = await page.locator('#status bdi').textContent();
  assert.match(reference, /^[A-F0-9]{16}$/);
  const retried = page.waitForResponse(response => response.url().endsWith('/api/drafts'));
  await button.click();
  assert.equal((await retried).status(), 200);
  assert.equal((await (await retried).json()).reference, reference);
  if (process.env.PILOT_DB) {
    const { DatabaseSync } = await import('node:sqlite');
    const database = new DatabaseSync(process.env.PILOT_DB, { readOnly: true });
    const row = database.prepare('SELECT flavor, price FROM drafts WHERE reference=?').get(reference);
    assert.equal(row.flavor, 'smooth');
    assert.equal(row.price, 59);
    database.close();
  }
  report.save = { abortRecovery: true, created: true, retrySameReference: true, databaseChecked: Boolean(process.env.PILOT_DB) };
}

for (const [engine, type, launch] of [
  ['Chrome', chromium, { channel: 'chrome' }],
  ['WebKit', webkit, {}],
]) {
  const browser = await type.launch(launch);
  report.engines.push({ engine, version: browser.version() });
  try {
    const viewports = engine === 'Chrome' ? sizes : [sizes[1], sizes[5]];
    for (const [width, height] of viewports) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      try {
        await checkPage(page, engine, width, engine === 'Chrome');
        console.log(`${engine} ${width}: passed`);
      } finally {
        await page.close();
      }
    }
    if (engine === 'Chrome') {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await checkSave(page);
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await checkNavigation(page);
      }
      report.navigationCheckedAt = [390, 1440];
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
assert.deepEqual(events, []);
report.browserErrors = events;
await writeFile(join(folder, 'browser.json'), JSON.stringify(report, null, 2) + '\n');

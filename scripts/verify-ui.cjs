/* Run against a fresh sample lesson: BASE_URL defaults to the static demo on :5173. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const output = process.env.OUTPUT_DIR || path.resolve(__dirname, '../docs/screenshots/refined');
fs.mkdirSync(output, { recursive: true });
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const checks = [];
  async function fits(label) {
    const result = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
    assert(result.content <= result.width + 1, `${label}: horizontal overflow ${JSON.stringify(result)}`);
    checks.push(`${label}: no horizontal overflow`);
  }
  async function screenshot(name) {
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
  }
  try {
    await page.goto(base);
    await page.getByRole('button', { name: 'Review lesson' }).waitFor();
    assert.equal(await page.locator('.capture-page img').count(), 0, 'Capture page must not display a photograph');
    assert.match(await page.locator('.capture-upload').innerText(), /up to 30 minutes/, 'Capture must advertise the 30-minute limit');
    checks.push('Capture page: photograph absent');
    for (const width of [360, 390, 768, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await fits(`Capture ${width}`);
      if (width === 390 || width === 1440) await screenshot(`capture-${width}`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Review lesson' }).click();
    await page.locator('.step-card').first().waitFor();
    assert(await page.getByRole('button', { name: 'Approve version' }).isDisabled(), 'Unresolved questions must block approval');
    await screenshot('review-1440');
    await page.setViewportSize({ width: 390, height: 1000 });
    await fits('Review 390');
    await screenshot('review-390');
    await page.setViewportSize({ width: 1440, height: 1000 });
    const firstInstructions = page.locator('.step-fields textarea').first();
    const original = await firstInstructions.inputValue();
    await firstInstructions.fill(original + ' ');
    assert(await page.locator('.question-card').first().getByRole('button', { name: 'Dismiss', exact: true }).isDisabled(), 'Unsaved edits must be protected');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('link', { name: 'Practice', exact: true }).click();
    assert(page.url().endsWith('#/review'), 'Cancelling navigation must retain unsaved lesson edits');
    await page.locator('.approval-bar').getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.getByText('Draft saved.', { exact: true }).waitFor();
    while (await page.locator('.question-card.q-open').count()) {
      const openCount = await page.locator('.question-card.q-open').count();
      const question = page.locator('.question-card.q-open').first();
      await question.locator('textarea').fill('Expert confirmation recorded for this isolated UI verification.');
      await question.getByRole('button', { name: 'Save answer' }).click();
      await page.waitForFunction((count) => document.querySelectorAll('.question-card.q-open').length < count, openCount);
    }
    await page.getByRole('button', { name: 'Approve version' }).click();
    await page.getByRole('button', { name: 'Version approved' }).waitFor();
    checks.push('Expert review: unsaved navigation cancelled, edits saved, questions resolved, approval gate enforced');
    await page.getByRole('link', { name: 'Practice', exact: true }).click();
    await page.locator('.lesson-card').first().waitFor();
    await screenshot('library-1440');
    await page.locator('.lesson-card').first().click();
    await page.locator('canvas').waitFor();
    await screenshot('practice-1440');
    for (const width of [360, 390, 768, 1280, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await fits(`Practice ${width}`);
      if (width === 390) await screenshot('practice-390');
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const canvas = page.locator('canvas');
    const drifting = await canvas.evaluate((element) => element.toDataURL());
    await page.waitForTimeout(100);
    assert.notEqual(await canvas.evaluate((element) => element.toDataURL()), drifting, 'Free-running trace must move');
    await page.getByRole('checkbox', { name: 'running', exact: true }).uncheck();
    await page.waitForTimeout(100);
    const stopped = await canvas.evaluate((element) => element.toDataURL());
    await page.waitForTimeout(100);
    assert.equal(await canvas.evaluate((element) => element.toDataURL()), stopped, 'Paused instrument must freeze');
    await page.getByRole('checkbox', { name: 'running', exact: true }).check();
    const pixels = await page.locator('canvas').evaluate((canvas) => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let yellow = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] > 170 && data[i + 1] > 140 && data[i + 2] < 150) yellow++;
      return yellow;
    });
    assert(pixels > 100, `Instrument trace must render, found ${pixels} yellow pixels`);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Volts per division').selectOption('0.5');
    await page.getByRole('button', { name: 'Check this step' }).click();
    await page.getByLabel('Time per division').selectOption('0.0005');
    await page.getByRole('button', { name: 'Check this step' }).click();
    for (let i = 0; i < 2; i++) {
      await page.getByRole('checkbox', { name: 'enabled', exact: true }).check();
      await page.getByLabel('Trigger edge').selectOption('rise');
      await page.getByLabel('Trigger level').fill('0.4');
      await page.getByRole('button', { name: 'Check this step' }).click();
    }
    await page.getByLabel('Trainee name').fill('UI verification');
    await page.getByRole('button', { name: 'Save attempt' }).click();
    await page.getByText(/Attempt stored/).waitFor();
    await screenshot('result-1440');
    await page.setViewportSize({ width: 390, height: 1000 });
    await fits('Result 390');
    checks.push(`Practice: trace rendered (${pixels} pixels), animation and pause verified, all five steps completed, attempt saved`);
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    console.log(JSON.stringify({ passed: true, checks, browserErrors: errors, screenshots: output }, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });

import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('approval flow, tool calls, file tabs, collapsed results, and simulated PR', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const card = page.getByRole('region', { name: 'Add rate limiting to the public API' });
  await expect(card).toHaveAttribute('data-status', 'waiting');
  await expect(card.locator('.ar-step')).toHaveCount(7);
  const time = await card.locator('.ar-elapsed').textContent();
  await page.waitForTimeout(700);
  await expect(card.locator('.ar-elapsed')).toHaveText(time!);

  const read = card.getByRole('button', { name: /Read src\/api\/routes.ts/ });
  await read.click();
  await expect(read).toHaveAttribute('aria-expanded', 'true');
  await expect(card.locator('.ar-tool-input')).toContainText('read_file src/api/routes.ts');
  await read.press('Enter');
  await expect(read).toHaveAttribute('aria-expanded', 'false');
  await page.waitForTimeout(400);

  const originalHeight = (await card.boundingBox())!.height;
  const firstTab = card.getByRole('tab', { name: /rate-limit.ts/ });
  const secondTab = card.getByRole('tab', { name: /routes.ts/ });
  await firstTab.focus();
  await firstTab.press('ArrowRight');
  await expect(secondTab).toHaveAttribute('aria-selected', 'true');
  await expect(secondTab).toBeFocused();
  await expect(card.locator('.ar-diff-panel[data-active="true"]')).toContainText('api.use(requireApiKey, rateLimit)');
  expect(Math.abs((await card.boundingBox())!.height - originalHeight)).toBeLessThan(1);
  await secondTab.press('Home');
  await expect(firstTab).toBeFocused();

  await card.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(card).toHaveAttribute('data-status', 'done');
  await expect(card.getByText('12 of 12 tests passed', { exact: true })).toBeVisible();
  const folded = card.getByRole('button', { name: /12 steps/ });
  await expect(folded).toHaveAttribute('aria-expanded', 'false');
  await folded.click();
  await expect(card.getByRole('list', { name: 'Steps' })).toBeVisible();
  await expect(card.locator('.ar-step')).toHaveCount(12);
  await folded.click();
  await card.getByRole('button', { name: 'Open pull request', exact: true }).click();
  await expect(card.getByRole('button', { name: 'PR #482 opened', exact: true })).toBeVisible();
  await expect(card.getByText('Preview only: PR #482 was simulated. No repository was changed.')).toBeVisible();
  await card.getByRole('button', { name: 'Restart run', exact: true }).click();
  await expect(card).toHaveAttribute('data-status', 'working');
  await expect(card.locator('.ar-result')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('rejection note, cancel focus, one revision, and a second rejection stop', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('.agent-run');
  await expect(card).toHaveAttribute('data-status', 'waiting');
  const reject = card.getByRole('button', { name: 'Reject', exact: true });
  await reject.click();
  const input = card.getByLabel('What should change?');
  await expect(input).toBeFocused();
  await input.press('Escape');
  await expect(reject).toBeFocused();
  await reject.click();
  await input.fill('   ');
  await expect(card.getByRole('button', { name: 'Send back', exact: true })).toBeDisabled();
  await input.fill('Make the rate limit configurable.');
  await input.press('Enter');
  await expect(card).toHaveAttribute('data-status', 'working');
  await expect(card).toHaveAttribute('data-status', 'waiting');
  await expect(card.locator('.ar-diff-panel[data-active="true"]')).toContainText('process.env.RATE_LIMIT_MAX');
  const sentBack = card.getByRole('button', { name: /Sent back changes to 2 files/ });
  await sentBack.click();
  await expect(card.getByText('Make the rate limit configurable.', { exact: true })).toBeVisible();
  await sentBack.click();
  await card.getByRole('button', { name: 'Reject', exact: true }).click();
  await card.getByLabel('What should change?').fill('Still not the change I need.');
  await card.getByRole('button', { name: 'Send back', exact: true }).click();
  await expect(card.getByRole('heading', { name: 'Run stopped' })).toBeVisible();
  await expect(card.getByText('The change was sent back. No files were written.')).toBeVisible();
  await expect(card.locator('.ar-result')).toHaveCount(0);
});

test('manual start, hidden preview pause, and offscreen clock pause', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Manual start', exact: true }).click();
  await page.getByRole('button', { name: 'Try this example' }).click();
  const card = page.locator('.agent-run');
  await expect(card.getByRole('button', { name: 'Start run', exact: true })).toBeVisible();
  await expect(card.locator('.ar-step')).toHaveCount(0);
  await card.getByRole('button', { name: 'Start run', exact: true }).click();
  await expect(card.locator('.ar-step')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.waitForTimeout(250);
  const paused = await card.locator('.ar-elapsed').textContent();
  await page.waitForTimeout(1300);
  await expect(card.locator('.ar-elapsed')).toHaveText(paused!);
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await page.locator('#api-reference').scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const offscreen = await card.locator('.ar-elapsed').textContent();
  await page.waitForTimeout(1300);
  await expect(card.locator('.ar-elapsed')).toHaveText(offscreen!);
});

test('responsive preview and expanded mode preserve the run', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.agent-run')).toHaveAttribute('data-status', 'waiting');
  await page.getByRole('button', { name: 'Mobile preview', exact: true }).click();
  await expect(page.locator('.agent-container')).toHaveCSS('max-width', '375px');
  await page.getByRole('button', { name: 'Expand preview', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Expanded agent run preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await page.getByLabel('What should change?').press('Escape');
  await expect(page.getByRole('dialog', { name: 'Expanded agent run preview' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Expanded agent run preview' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Expand preview', exact: true })).toBeFocused();
  await expect(page.locator('.agent-run')).toHaveAttribute('data-status', 'waiting');
});

test('library search, saved state, code examples, and persistent theme', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Copy page', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copied to clipboard' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('# Agent run');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.keyboard.press('Control+k');
  const search = page.getByRole('combobox', { name: 'Search blocks and documentation' });
  await expect(search).toBeFocused();
  await search.fill('zzzzzz');
  await expect(page.getByText('No results for "zzzzzz"')).toBeVisible();
  await search.fill('Usage');
  await search.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Search the library' })).not.toBeVisible();
  await page.getByRole('tab', { name: 'Live runtime', exact: true }).click();
  await expect(page.locator('#usage-example-panel')).toContainText('onOpenPullRequest');
});

test('320px layout and reduced motion keep every interaction accessible', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.agent-run')).toHaveAttribute('data-status', 'waiting');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(page.getByRole('button', { name: /Search the library/ })).toBeVisible();
  await page.getByRole('button', { name: 'Close navigation', exact: true }).first().click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.locator('.agent-run')).toHaveAttribute('data-status', 'done');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expect(page.locator('.ar-result-summary')).toBeVisible();
});

test('controlled runtime callbacks, rejection, PR failure retry, and restart', async ({ page }) => {
  await page.goto('/tests/fixtures/agent-run.html');
  const card = page.getByRole('region', { name: 'Live runtime task' });
  await expect(card).toHaveAttribute('data-status', 'waiting');
  await card.getByRole('button', { name: 'Reject', exact: true }).click();
  await card.getByLabel('What should change?').fill('Runtime feedback');
  await card.getByRole('button', { name: 'Send back', exact: true }).click();
  await expect(page.getByLabel('Runtime callback')).toHaveText('rejected:rate-limit-v1:Runtime feedback');
  await expect(card).toHaveAttribute('data-status', 'waiting');
  await card.getByRole('button', { name: 'Cancel', exact: true }).click();
  await card.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByLabel('Runtime callback')).toHaveText('approved:rate-limit-v1');
  await expect(card).toHaveAttribute('data-status', 'done');
  await card.getByRole('button', { name: 'Open pull request', exact: true }).click();
  await expect(card.getByRole('alert')).toHaveText('Repository unavailable. Try again.');
  await card.getByRole('button', { name: 'Open pull request', exact: true }).click();
  await expect(card.getByRole('link', { name: /PR #917 opened/ })).toHaveAttribute('href', 'https://example.com/pull/917');
  await card.getByRole('button', { name: 'Restart run', exact: true }).click();
  await expect(page.getByLabel('Runtime callback')).toHaveText('restarted');
  await expect(card).toHaveAttribute('data-status', 'waiting');
});

test('custom script runs only after Start and respects its approval gate', async ({ page }) => {
  await page.goto('/tests/fixtures/agent-run.html?scenario=custom');
  const card = page.getByRole('region', { name: 'A custom script' });
  await expect(card.getByRole('button', { name: 'Start run', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Start run', exact: true }).click();
  await expect(card).toHaveAttribute('data-status', 'waiting');
  await expect(card.getByRole('button', { name: /Read custom.ts/ })).toBeVisible();
  await card.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(card).toHaveAttribute('data-status', 'done');
  await expect(card.getByRole('button', { name: /3 steps/ })).toBeVisible();
});

test('agent card has no serious accessibility violations in light or dark', async ({ page }) => {
  await page.goto('/tests/fixtures/agent-run.html');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    const report = await new AxeBuilder({ page }).include('.agent-run').analyze();
    expect(report.violations.map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.map(node => node.target) }))).toEqual([]);
  }
});

test('hidden document pauses the clock and visibility resumes it', async ({ page }) => {
  await page.goto('/tests/fixtures/agent-run.html?scenario=clock');
  const card = page.locator('.agent-run');
  await card.getByRole('button', { name: 'Start run', exact: true }).click();
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const time = await card.locator('.ar-step-duration').textContent();
  await page.waitForTimeout(1300);
  await expect(card.locator('.ar-step-duration')).toHaveText(time!);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(card).toHaveAttribute('data-status', 'waiting');
});

test('the full preview page passes light and dark accessibility audits', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.agent-run')).toHaveAttribute('data-status', 'waiting');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await page.waitForTimeout(250);
    const report = await new AxeBuilder({ page }).analyze();
    expect(report.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) }))).toEqual([]);
  }
  await page.getByRole('button', { name: 'Restart run', exact: true }).focus();
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  expect(outline).toBe('solid');
});
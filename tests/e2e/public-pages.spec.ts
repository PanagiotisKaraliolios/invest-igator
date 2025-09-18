import { test, testNoConsent, expect } from './fixtures';

// Basic smoke tests for public pages.

testNoConsent('consent banner appears only once', async ({ page }) => {
  await page.goto('/');
  const banner = page.getByRole('dialog');
  await expect(banner).toBeVisible();
  await page.getByRole('button', { name: /Accept all/i }).click();
  await expect(banner).toBeHidden();
  await page.reload();
  await expect(banner).toBeHidden();
});

test('home loads and shows CTA', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Track portfolios/i })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get started', exact: true })).toBeVisible();
});


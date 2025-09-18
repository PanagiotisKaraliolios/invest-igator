import { expect, test } from './fixtures';

// Basic smoke test for the landing page
// - Confirms the app boots
// - Checks for key hero text and CTAs
// - Verifies no unexpected 500s in console

test('landing page renders and shows hero', async ({ page }) => {
	const base = process.env.E2E_BASE_URL || 'http://localhost:3000';
	const errors: string[] = [];

	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(msg.text());
	});

	await page.goto(base, { waitUntil: 'domcontentloaded' });

	await expect(page.locator('h1')).toContainText(/Track portfolios/i);
	await expect(page.getByRole('link', { name: 'Get started', exact: true })).toBeVisible();

	// No server crashes surfaced to client console
	expect(errors.join('\n')).not.toMatch(/500|Unhandled|TypeError/i);
});

import { expect, test } from './fixtures';

// Smoke test for the Returns page. Requires credentials because the
// dashboard area is protected. Skips when env vars are not provided.

test.describe('Portfolio Returns page', () => {
	test('renders controls and cards (authenticated)', async ({ page }) => {
		const email = process.env.E2E_TEST_EMAIL;
		const password = process.env.E2E_TEST_PASSWORD;
		test.skip(!email || !password, 'E2E_TEST_EMAIL/PASSWORD not set');

		const base = process.env.E2E_BASE_URL || 'http://localhost:3000';

		await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
		await page.getByTestId('cred-email').fill(email!);
		await page.getByTestId('cred-password').fill(password!);
		await page.getByTestId('cred-submit').click();

		await page.waitForURL(`${base}/dashboard`);

		await page.goto(`${base}/portfolio/returns`);

		// Controls
		await expect(page.getByTestId('controls-row')).toBeVisible();
		await expect(page.getByTestId('mode-toggle')).toBeVisible();
		await expect(page.getByTestId('series-toggle')).toBeVisible();
		await expect(page.getByTestId('period-select')).toBeVisible();

		// Summary cards
		await expect(page.getByTestId('total-return-card')).toBeVisible();
		await expect(page.getByTestId('prev-day-return-card')).toBeVisible();
	});
});

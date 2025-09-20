import { expect, test } from './fixtures';

// Optional: requires valid creds to access dashboard-only routes
test('transactions page renders table for authenticated user', async ({ page }) => {
	const email = process.env.E2E_TEST_EMAIL;
	const password = process.env.E2E_TEST_PASSWORD;
	test.skip(!email || !password, 'E2E_TEST_EMAIL/PASSWORD not set');

	const base = process.env.E2E_BASE_URL || 'http://localhost:3000';
	await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });

	await page.getByTestId('cred-email').fill(email!);
	await page.getByTestId('cred-password').fill(password!);
	await page.getByTestId('cred-submit').click();

	await page.waitForURL(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });

	await page.goto(`${base}/transactions`, { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
	await expect(page.getByTestId('transactions-search')).toBeVisible();
});

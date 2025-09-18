import { expect, test } from './fixtures';

// Unauthenticated users should be able to reach login page
// and see form fields.

test('login page loads with form', async ({ page }) => {
	const base = process.env.E2E_BASE_URL || 'http://localhost:3000';
	await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });

	await expect(page.getByTestId('cred-email')).toBeVisible();
	await expect(page.getByTestId('cred-password')).toBeVisible();
	await expect(page.getByTestId('cred-submit')).toBeVisible();
});

// Optional: credentials login flow; runs only if env vars provided.
test('credentials login redirects to /dashboard', async ({ page }) => {
	const email = process.env.E2E_TEST_EMAIL;
	const password = process.env.E2E_TEST_PASSWORD;
	test.skip(!email || !password, 'E2E_TEST_EMAIL/PASSWORD not set');

	const base = process.env.E2E_BASE_URL || 'http://localhost:3000';
	await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });

	await page.getByTestId('cred-email').fill(email!);
	await page.getByTestId('cred-password').fill(password!);
	await page.getByTestId('cred-submit').click();

	// Wait for navigation/redirect
	await page.waitForURL(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });

	await expect(page).toHaveURL(`${base}/dashboard`);
	// Basic sanity: dashboard shell visible
	await expect(page.getByRole('navigation')).toBeVisible();
});

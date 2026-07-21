import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { expect, test } from './fixtures';

/**
 * Builds a deterministic AI-SDK v7 UI-message SSE response — a text-only assistant reply, no
 * live model involved — using the SDK's OWN stream helpers (`createUIMessageStream` +
 * `createUIMessageStreamResponse`), so the wire format (SSE framing, headers, chunk shapes) is
 * guaranteed to match what `useChat`'s `DefaultChatTransport` expects. This is intercepted via
 * `page.route` below instead of hand-vendoring an SSE string.
 */
async function cannedChatFixture(): Promise<{ body: string; headers: Record<string, string>; status: number }> {
	const response = createUIMessageStreamResponse({
		stream: createUIMessageStream({
			execute: ({ writer }) => {
				writer.write({ id: 'reply-1', type: 'text-start' });
				writer.write({ delta: 'Your portfolio is worth €48,230.', id: 'reply-1', type: 'text-delta' });
				writer.write({ id: 'reply-1', type: 'text-end' });
			}
		})
	});
	return {
		body: await response.text(),
		headers: Object.fromEntries(response.headers.entries()),
		status: response.status
	};
}

// Creds-gated like the other dashboard E2Es (tests/e2e/transactions.spec.ts) — skips when
// E2E_TEST_EMAIL/PASSWORD aren't set (e.g. in CI without a seeded app).
test('user opens the chat drawer, sends a message, and sees the streamed reply', async ({ page }) => {
	const email = process.env.E2E_TEST_EMAIL;
	const password = process.env.E2E_TEST_PASSWORD;
	test.skip(!email || !password, 'E2E_TEST_EMAIL/PASSWORD not set');

	const base = process.env.E2E_BASE_URL || 'http://localhost:3000';
	await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });

	await page.getByTestId('cred-email').fill(email!);
	await page.getByTestId('cred-password').fill(password!);
	await page.getByTestId('cred-submit').click();

	await page.waitForURL(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });

	// Register the intercept BEFORE opening the drawer, so the very first turn hits it.
	const fixture = await cannedChatFixture();
	await page.route('**/api/ai/chat', async (route) => {
		await route.fulfill(fixture);
	});

	await page.getByTestId('chat-launcher').click();

	// Art. 50 disclosure — always visible, no dismiss affordance.
	await expect(page.getByText(/not financial advice/i)).toBeVisible();

	await page.getByPlaceholder('Ask about your portfolio…').fill('How is my portfolio doing?');
	await page.keyboard.press('Enter');

	// The user's own turn renders immediately (optimistic), then the streamed reply arrives.
	await expect(page.getByText('How is my portfolio doing?')).toBeVisible();
	await expect(page.getByText(/48,230/)).toBeVisible();
});

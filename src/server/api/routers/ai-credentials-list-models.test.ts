import { describe, expect, test } from 'bun:test';
import { safeProviderErrorMessage } from '@/server/ai/provider-errors';

describe('safeProviderErrorMessage', () => {
	test('replaces every occurrence of the secret', () => {
		const error = new Error('401 from https://api.openai.com with key sk-secret-123 (sk-secret-123)');
		const message = safeProviderErrorMessage(error, 'sk-secret-123');

		expect(message).not.toContain('sk-secret-123');
		expect(message).toContain('[redacted]');
	});

	test('truncates to 300 characters', () => {
		const message = safeProviderErrorMessage(new Error('x'.repeat(500)), 'sk-x');
		expect(message.length).toBe(300);
	});

	test('handles a non-Error throw without leaking the secret', () => {
		expect(safeProviderErrorMessage('sk-secret-123', 'sk-secret-123')).toBe('Unknown provider error');
	});

	// FIX 4: GOOGLE puts `encodeURIComponent(secret)` in the URL. A secret containing
	// URL-special characters must be redacted in BOTH its plaintext and percent-encoded
	// forms — otherwise the encoded fragment survives and is trivially decodable.
	test('redacts a percent-encoded secret as well as the plaintext form', () => {
		const secret = 'sk-a+b/c=d&e:f';
		const encoded = encodeURIComponent(secret);
		const error = new Error(`fetch failed: https://generativelanguage.googleapis.com/v1beta/models?key=${encoded}`);
		const message = safeProviderErrorMessage(error, secret);

		expect(message).not.toContain(secret);
		expect(message).not.toContain(encoded);
		expect(message).toContain('[redacted]');
	});

	// FIX 6: `list-models.ts` already wraps its own throw in this function before
	// rethrowing (a plain `new Error(...)`), and the tRPC layer redacts again — a second
	// `${name}: ` prefix on a bare `Error` would read as "Error: Error: ...". Named
	// subclasses still show their name.
	test('omits the "Error: " prefix for a bare Error, but keeps it for a named subclass', () => {
		const bare = safeProviderErrorMessage(new Error('The provider returned 401 Unauthorized'), 'sk-x');
		expect(bare).toBe('The provider returned 401 Unauthorized');

		const named = safeProviderErrorMessage(new TypeError('Failed to fetch'), 'sk-x');
		expect(named).toBe('TypeError: Failed to fetch');
	});
});

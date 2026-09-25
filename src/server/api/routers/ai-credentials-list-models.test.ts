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

	// No plaintext in scope (a server-side log, e.g. `aiImport.preview`). An empty secret must
	// not reach `replaceAll('')`, which splices `[redacted]` between every character.
	test('an empty or null secret leaves an ordinary message readable', () => {
		const error = new Error('The provider returned 401 Unauthorized');
		expect(safeProviderErrorMessage(error, '')).toBe('The provider returned 401 Unauthorized');
		expect(safeProviderErrorMessage(error, null)).toBe('The provider returned 401 Unauthorized');
	});

	test('with no secret in scope, strips auth-header values in raw, JSON and inspect() spellings', () => {
		const key = 'gw-live-0123456789abcdef';
		const message = safeProviderErrorMessage(
			new Error(
				`401. Sent Authorization: Bearer ${key}; headers {"authorization":"Bearer ${key}","x-api-key":"${key}"} ` +
					`{ 'api-key': '${key}', 'x-goog-api-key': '${key}' }`
			),
			null
		);

		expect(message).not.toContain(key);
		expect(message).toContain('Authorization: [redacted]');
		expect(message).toContain('"x-api-key":"[redacted]"');
		expect(message).toContain("'api-key': '[redacted]'");
	});

	test('with no secret in scope, strips a bare bearer token, a ?key= query value and known key prefixes', () => {
		const bearer = 'eyJhbGciOiJIUzI1NiJ9.payload.sig';
		const google = `AIza${'A'.repeat(35)}`;
		const openai = 'sk-proj-abcdefghijklmnop1234';
		const anthropic = 'sk-ant-api03-abcdefghijklmnop';
		const message = safeProviderErrorMessage(
			new TypeError(
				`fetch failed: https://generativelanguage.googleapis.com/v1beta/models?key=${google}&alt=json ` +
					`(Bearer ${bearer}) keys ${openai} ${anthropic}`
			),
			null
		);

		for (const leaked of [bearer, google, openai, anthropic]) {
			expect(message).not.toContain(leaked);
		}
		expect(message).toContain('?key=[redacted]&alt=json');
		expect(message.startsWith('TypeError: fetch failed')).toBe(true);
	});

	// The pattern pass runs with a known secret too (a backstop), but must not eat provider
	// prose: a label only counts when an explicit `:`/`=` follows it.
	test('the credential-pattern pass keeps provider prose intact', () => {
		const prose = 'Incorrect API key provided: sk-proj-****abcd. Bearer token is invalid.';
		expect(safeProviderErrorMessage(new Error(prose), 'sk-unrelated-secret')).toBe(prose);
		expect(safeProviderErrorMessage(new Error(prose), null)).toBe(prose);
	});
});

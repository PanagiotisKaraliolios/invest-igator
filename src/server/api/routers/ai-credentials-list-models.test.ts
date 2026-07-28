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
});

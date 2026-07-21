import { describe, expect, test } from 'bun:test';
import { errorCopy } from './chat-errors';

describe('errorCopy', () => {
	test('maps known codes to human copy', () => {
		expect(errorCopy('QUOTA_EXCEEDED')).toMatch(/usage limit/i);
		expect(errorCopy('NO_SUCH_CREDENTIAL')).toMatch(/Settings/i);
		expect(errorCopy('WHATEVER')).toMatch(/something went wrong/i);
	});

	test('CREDENTIAL_REJECTED mentions Settings', () => {
		expect(errorCopy('CREDENTIAL_REJECTED')).toMatch(/Settings/i);
	});

	test('NO_PLATFORM_MODEL and CHAT_FAILED map to non-empty copy', () => {
		expect(errorCopy('NO_PLATFORM_MODEL').length).toBeGreaterThan(0);
		expect(errorCopy('CHAT_FAILED').length).toBeGreaterThan(0);
	});
});

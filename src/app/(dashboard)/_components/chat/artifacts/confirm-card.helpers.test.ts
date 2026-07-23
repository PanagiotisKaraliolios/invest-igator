import { describe, expect, test } from 'bun:test';
import { isExpired } from './confirm-card.helpers';

describe('isExpired', () => {
	const at = '2026-01-02T00:02:00.000Z';
	test('false before expiry', () => {
		expect(isExpired(at, Date.parse('2026-01-02T00:01:00.000Z'))).toBe(false);
	});
	test('true after expiry', () => {
		expect(isExpired(at, Date.parse('2026-01-02T00:03:00.000Z'))).toBe(true);
	});
	test('malformed expiresAt is treated as expired (fail closed)', () => {
		expect(isExpired('not-a-date', Date.parse('2026-01-02T00:00:00.000Z'))).toBe(true);
	});
});

import { describe, expect, test } from 'bun:test';
import { type MutationPayload, signMutation, verifyMutation } from './token';

const SECRET = 'x'.repeat(32);
function payload(over: Partial<MutationPayload> = {}): MutationPayload {
	return {
		args: { symbol: 'AAPL' },
		exp: 1120,
		iat: 1000,
		jti: 'j1',
		tool: 'transactions.create',
		userId: 'u1',
		v: 1,
		...over
	};
}

describe('mutation token', () => {
	test('round-trips a payload', () => {
		const token = signMutation(payload(), SECRET);
		const res = verifyMutation(token, SECRET, 1000);
		expect(res.ok).toBe(true);
		if (res.ok) expect(res.payload).toEqual(payload());
	});

	test('rejects a tampered payload', () => {
		const token = signMutation(payload(), SECRET);
		const [p, sig] = token.split('.');
		const forged = Buffer.from(JSON.stringify(payload({ args: { symbol: 'TSLA' } }))).toString('base64url');
		const res = verifyMutation(`${forged}.${sig}`, SECRET, 1000);
		expect(res).toEqual({ ok: false, reason: 'INVALID' });
		expect(p.length).toBeGreaterThan(0);
	});

	test('rejects a wrong secret', () => {
		const token = signMutation(payload(), SECRET);
		expect(verifyMutation(token, 'y'.repeat(32), 1000)).toEqual({ ok: false, reason: 'INVALID' });
	});

	test('rejects a malformed token', () => {
		expect(verifyMutation('not-a-token', SECRET, 1000)).toEqual({ ok: false, reason: 'INVALID' });
	});

	test('rejects an expired token (now > exp)', () => {
		const token = signMutation(payload({ exp: 1120 }), SECRET);
		expect(verifyMutation(token, SECRET, 1121)).toEqual({ ok: false, reason: 'EXPIRED' });
	});

	test('signature is verified BEFORE expiry (a tampered expired token is INVALID, not EXPIRED)', () => {
		const token = signMutation(payload({ exp: 1120 }), SECRET);
		const forged = Buffer.from(JSON.stringify(payload({ exp: 9999 }))).toString('base64url');
		const [, sig] = token.split('.');
		expect(verifyMutation(`${forged}.${sig}`, SECRET, 5000)).toEqual({ ok: false, reason: 'INVALID' });
	});
});

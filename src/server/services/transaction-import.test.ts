import { describe, expect, test } from 'bun:test';
import { CANONICAL_HEADER, validateRow } from './transaction-import';

const headerMap = new Map(CANONICAL_HEADER.map((h, i) => [h, i]));
// cells ordered as CANONICAL_HEADER: date,symbol,side,quantity,price,priceCurrency,fee,feeCurrency,note
const ok = ['2026-01-15', 'AAPL', 'BUY', '10', '150.5', 'USD', '', '', ''];

describe('validateRow', () => {
	test('accepts a well-formed canonical row', () => {
		const res = validateRow(ok, headerMap, new Set());
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.record.symbol).toBe('AAPL');
			expect(res.record.side).toBe('BUY');
			expect(res.record.quantity).toBe(10);
			expect(res.record.price).toBe(150.5);
			expect(res.record.priceCurrency).toBe('USD');
			expect(res.record.date.toISOString().slice(0, 10)).toBe('2026-01-15');
		}
	});

	test('rejects a non-positive quantity', () => {
		const res = validateRow(['2026-01-15', 'AAPL', 'BUY', '0', '150.5', 'USD', '', '', ''], headerMap, new Set());
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.message).toMatch(/quantity/i);
	});

	test('rejects a symbol flagged unknown by Yahoo', () => {
		const res = validateRow(ok, headerMap, new Set(['AAPL']));
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.message).toMatch(/not found/i);
	});

	test('rejects an invalid date', () => {
		const res = validateRow(['15/01/2026', 'AAPL', 'BUY', '10', '150.5', 'USD', '', '', ''], headerMap, new Set());
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.message).toMatch(/date/i);
	});
});

import { describe, expect, test } from 'bun:test';
import { createTransactionInput, updateTransactionInput } from './transactions.schemas';

/**
 * Pins the date validation on the mutations themselves, not just on the shared schema.
 *
 * Asserting `isoDateSchema` rejects '2026-02-30' would keep passing if a mutation quietly
 * went back to `z.string().transform((s) => new Date(s))` — which is how `update` came to
 * store 2026-03-02 for an input of 2026-02-30 while every other write path was guarded.
 * These assertions run against the exact schemas the procedures are wired to.
 */

// None of these days exist. `new Date` rolls them forward instead of failing, so an
// unguarded path stores a different day than the user sent, with no error anywhere.
const impossibleDates = ['2026-02-30', '2026-04-31', '2026-13-01', '2026-02-29'];

const validCreate = {
	date: '2026-01-05',
	price: 10,
	priceCurrency: 'USD',
	quantity: 1,
	side: 'BUY',
	symbol: 'AAPL'
};

describe('createTransactionInput', () => {
	test('rejects impossible calendar dates', () => {
		for (const date of impossibleDates) {
			expect(createTransactionInput.safeParse({ ...validCreate, date }).success).toBe(false);
		}
	});

	test('accepts a real date and yields UTC midnight', () => {
		const parsed = createTransactionInput.parse(validCreate);
		expect(parsed.date.toISOString()).toBe('2026-01-05T00:00:00.000Z');
	});

	test('rejects a full ISO datetime — callers send a bare yyyy-mm-dd', () => {
		expect(createTransactionInput.safeParse({ ...validCreate, date: '2026-01-05T12:00:00Z' }).success).toBe(false);
	});
});

describe('updateTransactionInput', () => {
	test('rejects impossible calendar dates', () => {
		for (const date of impossibleDates) {
			expect(updateTransactionInput.safeParse({ date, id: 'tx_1' }).success).toBe(false);
		}
	});

	test('accepts a real date and yields UTC midnight', () => {
		const parsed = updateTransactionInput.parse({ date: '2026-01-05', id: 'tx_1' });
		expect(parsed.date?.toISOString()).toBe('2026-01-05T00:00:00.000Z');
	});

	test('leaves the date optional — a partial edit that omits it is valid', () => {
		const parsed = updateTransactionInput.parse({ id: 'tx_1', quantity: 2 });
		expect(parsed.date).toBeUndefined();
	});
});

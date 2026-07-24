import { describe, expect, test } from 'bun:test';
import { CANONICAL_HEADER } from '@/server/services/transaction-import';
import { applyMapping, CANONICAL, type ColumnMapping, reformatDate } from './schema';

describe('reformatDate', () => {
	test('passes ISO through', () => expect(reformatDate('2026-01-15', 'ISO')).toBe('2026-01-15'));
	test('MDY_SLASH → ISO', () => expect(reformatDate('01/15/2026', 'MDY_SLASH')).toBe('2026-01-15'));
	test('DMY_DOT → ISO', () => expect(reformatDate('15.01.2026', 'DMY_DOT')).toBe('2026-01-15'));
	test('leaves an unrecognizable value untouched (validateRow will flag it)', () =>
		expect(reformatDate('nope', 'MDY_SLASH')).toBe('nope'));
});

describe('CANONICAL', () => {
	test('matches CANONICAL_HEADER in transaction-import.ts', () => {
		expect([...CANONICAL]).toEqual([...CANONICAL_HEADER]);
	});
});

describe('applyMapping', () => {
	// broker header: Trade Date, Ticker, Action, Qty, Fill Price  (indices 0..4)
	const mapping: ColumnMapping = {
		date: 0,
		dateFormat: 'MDY_SLASH',
		fee: null,
		feeCurrency: null,
		note: null,
		price: 4,
		priceCurrency: null,
		quantity: 3,
		side: 2,
		sideMap: [
			{ from: 'B', to: 'BUY' },
			{ from: 'S', to: 'SELL' }
		],
		symbol: 1
	};
	test('reorders to canonical columns, remaps side, reformats date', () => {
		const out = applyMapping([['01/15/2026', 'AAPL', 'B', '10', '150.5']], mapping);
		// canonical order: date,symbol,side,quantity,price,priceCurrency,fee,feeCurrency,note
		expect(out[0]).toEqual(['2026-01-15', 'AAPL', 'BUY', '10', '150.5', '', '', '', '']);
	});
	test('unmapped optional columns become empty strings', () => {
		const out = applyMapping([['01/15/2026', 'AAPL', 'S', '1', '2']], mapping);
		expect(out[0]?.slice(5)).toEqual(['', '', '', '']);
	});
});

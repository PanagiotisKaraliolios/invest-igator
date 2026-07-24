import { describe, expect, test } from 'bun:test';
import { type ReviewRowWithInclude, toBulkImportRows } from './import-flow.helpers';

function row(overrides: Partial<ReviewRowWithInclude> = {}): ReviewRowWithInclude {
	return {
		include: true,
		line: 2,
		status: 'ok',
		values: {
			date: '2024-01-15',
			fee: '',
			feeCurrency: '',
			note: '',
			price: '150.5',
			priceCurrency: 'USD',
			quantity: '10',
			side: 'BUY',
			symbol: 'AAPL'
		},
		...overrides
	};
}

describe('toBulkImportRows', () => {
	test('excludes needs-fix rows even when checked', () => {
		expect(toBulkImportRows([row({ status: 'needs-fix' })])).toEqual([]);
	});

	test('excludes unchecked rows even when otherwise valid', () => {
		expect(toBulkImportRows([row({ include: false })])).toEqual([]);
	});

	test('keeps a checked duplicate row — only needs-fix is excluded', () => {
		expect(toBulkImportRows([row({ status: 'duplicate' })])).toHaveLength(1);
	});

	test('maps a valid checked row with numeric coercion and empty-string -> undefined optionals', () => {
		expect(toBulkImportRows([row()])).toEqual([
			{
				date: '2024-01-15',
				fee: undefined,
				feeCurrency: undefined,
				note: undefined,
				price: 150.5,
				priceCurrency: 'USD',
				quantity: 10,
				side: 'BUY',
				symbol: 'AAPL'
			}
		]);
	});

	test('coerces fee/feeCurrency/note through when present', () => {
		const result = toBulkImportRows([
			row({
				values: {
					date: '2024-02-01',
					fee: '1.25',
					feeCurrency: 'EUR',
					note: 'brokerage fee',
					price: '99.9',
					priceCurrency: 'GBP',
					quantity: '3',
					side: 'SELL',
					symbol: 'MSFT'
				}
			})
		]);
		expect(result).toEqual([
			{
				date: '2024-02-01',
				fee: 1.25,
				feeCurrency: 'EUR',
				note: 'brokerage fee',
				price: 99.9,
				priceCurrency: 'GBP',
				quantity: 3,
				side: 'SELL',
				symbol: 'MSFT'
			}
		]);
	});

	test('mixed batch keeps only checked, non-needs-fix rows', () => {
		const rows = [
			row({ line: 2, status: 'ok' }),
			row({ include: false, line: 3, status: 'ok' }),
			row({ line: 4, message: 'Unknown symbol', status: 'needs-fix' }),
			row({ line: 5, status: 'duplicate' })
		];
		expect(toBulkImportRows(rows).map((r) => r.symbol)).toEqual(['AAPL', 'AAPL']);
	});
});

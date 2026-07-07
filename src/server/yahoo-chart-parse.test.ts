import { describe, expect, test } from 'bun:test';
import { classifyChartResponse } from './yahoo-chart-parse';

describe('classifyChartResponse', () => {
	test('not-found when Yahoo returns no result (chart.error set)', () => {
		const out = classifyChartResponse({ chart: { error: { code: 'Not Found' }, result: undefined } });
		expect(out.status).toBe('not-found');
		expect(out.bars).toEqual([]);
	});

	test('empty when result present but no usable bars', () => {
		const out = classifyChartResponse({
			chart: { result: [{ indicators: { quote: [{}] }, meta: { currency: 'USD', gmtoffset: 0 }, timestamp: [] }] }
		});
		expect(out.status).toBe('empty');
		expect(out.bars).toEqual([]);
		expect(out.currency).toBe('USD');
	});

	test('found with real bars', () => {
		const out = classifyChartResponse({
			chart: {
				result: [
					{
						indicators: { quote: [{ close: [10.5], high: [11], low: [9], open: [10], volume: [1000] }] },
						meta: { currency: 'GBp', gmtoffset: 0 },
						timestamp: [1704067200]
					}
				]
			}
		});
		expect(out.status).toBe('found');
		expect(out.bars).toHaveLength(1);
		expect(out.bars[0]!.close).toBe(10.5);
		expect(out.currency).toBe('GBp');
	});
});

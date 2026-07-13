import { beforeEach, describe, expect, mock, test } from 'bun:test';

/**
 * Hermetic: Influx is a recording double. This suite asserts the injection-relevant
 * behaviour directly — a malformed symbol never reaches Flux at all, and a well-formed
 * one reaches it only as a quoted literal, normalised.
 */

let lastFlux: string | null = null;
let queryCount = 0;
let nextRows: Array<{ _time?: unknown; _value?: unknown }> = [];

mock.module('@/server/influx', () => ({
	fluxStringLiteral: (value: string) => JSON.stringify(value),
	influxQueryApi: {
		collectRows: async (flux: string) => {
			queryCount += 1;
			lastFlux = flux;
			return nextRows;
		}
	},
	measurement: 'daily_bars'
}));

const { clampHistoryDays, getPriceHistory, MAX_HISTORY_DAYS, toPricePoints } = await import('./market');

beforeEach(() => {
	lastFlux = null;
	queryCount = 0;
	nextRows = [];
});

describe('toPricePoints', () => {
	test('coerces the numeric-STRING _value Influx sometimes returns', () => {
		expect(
			toPricePoints([
				{ _time: '2024-01-02T00:00:00Z', _value: '110.25' },
				{ _time: '2024-01-01T00:00:00Z', _value: 100 }
			])
		).toEqual([
			{ date: '2024-01-01', value: 100 },
			{ date: '2024-01-02', value: 110.25 }
		]);
	});

	test('truncates the RFC3339 _time to yyyy-mm-dd', () => {
		const points = toPricePoints([{ _time: '2024-06-30T13:45:12.123456789Z', _value: 1 }]);
		expect(points[0]?.date).toBe('2024-06-30');
	});

	test('drops rows with a null/non-finite value or an unusable timestamp', () => {
		expect(
			toPricePoints([
				{ _time: '2024-01-01T00:00:00Z', _value: null },
				{ _time: '2024-01-02T00:00:00Z', _value: 'not-a-number' },
				{ _time: null, _value: 5 },
				{ _time: '2024-01', _value: 5 },
				{ _time: '2024-01-03T00:00:00Z', _value: 7 }
			])
		).toEqual([{ date: '2024-01-03', value: 7 }]);
	});

	test('sorts ascending by date', () => {
		const points = toPricePoints([
			{ _time: '2024-03-01T00:00:00Z', _value: 3 },
			{ _time: '2024-01-01T00:00:00Z', _value: 1 },
			{ _time: '2024-02-01T00:00:00Z', _value: 2 }
		]);
		expect(points.map((p) => p.value)).toEqual([1, 2, 3]);
	});
});

describe('clampHistoryDays', () => {
	test('clamps to [1, MAX_HISTORY_DAYS] and truncates', () => {
		expect(clampHistoryDays(0)).toBe(1);
		expect(clampHistoryDays(90.7)).toBe(90);
		expect(clampHistoryDays(999_999)).toBe(MAX_HISTORY_DAYS);
		expect(clampHistoryDays(Number.NaN)).toBe(1);
	});
});

describe('getPriceHistory — THE MODEL NEVER AUTHORS FLUX', () => {
	test('a malformed symbol short-circuits: empty series, and Influx is never queried', async () => {
		expect(await getPriceHistory('AAPL") |> yield(', 30, 'close')).toEqual([]);
		expect(await getPriceHistory('', 30, 'close')).toEqual([]);
		expect(queryCount).toBe(0);
	});

	test('the symbol is normalised and both symbol and field appear only as quoted literals', async () => {
		await getPriceHistory('  aapl ', 5, 'high');
		expect(queryCount).toBe(1);
		expect(lastFlux).toContain('r.symbol == "AAPL"');
		expect(lastFlux).toContain('r._field == "high"');
		// window + 3 days of slack
		expect(lastFlux).toContain('range(start: -8d)');
	});

	test('the window is clamped and only its tail is returned', async () => {
		nextRows = [
			{ _time: '2024-01-01T00:00:00Z', _value: 1 },
			{ _time: '2024-01-02T00:00:00Z', _value: 2 },
			{ _time: '2024-01-03T00:00:00Z', _value: 3 },
			{ _time: '2024-01-04T00:00:00Z', _value: 4 }
		];
		expect(await getPriceHistory('AAPL', 2, 'close')).toEqual([
			{ date: '2024-01-03', value: 3 },
			{ date: '2024-01-04', value: 4 }
		]);
	});
});

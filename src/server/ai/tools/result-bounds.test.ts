import { describe, expect, test } from 'bun:test';
import { boundArrayElements, MAX_TOOL_RESULT_CHARS } from './result-bounds';

describe('boundArrayElements', () => {
	test('returns every element untruncated when the envelope already fits', () => {
		const items = [1, 2, 3];
		const { items: out, truncated } = boundArrayElements(items, (slice) => ({ values: slice }));
		expect(out).toEqual(items);
		expect(truncated).toBe(false);
	});

	test('drops elements from the TAIL, never mid-record, when the envelope is oversized', () => {
		// Each element alone is small, but there are enough of them to blow the budget.
		const items = Array.from({ length: 5000 }, (_, i) => ({ i, note: 'x'.repeat(50) }));
		const { items: out, truncated } = boundArrayElements(items, (slice) => ({ rows: slice }));
		expect(truncated).toBe(true);
		expect(out.length).toBeGreaterThan(0);
		expect(out.length).toBeLessThan(items.length);
		// It is a PREFIX — array-element truncation, not a re-ordered or sampled subset.
		expect(out).toEqual(items.slice(0, out.length));
		// The actual rendered result is provably under budget — not merely "smaller".
		expect(JSON.stringify({ rows: out }).length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
	});

	test('never corrupts JSON: the rendered envelope always parses back cleanly', () => {
		const items = Array.from({ length: 3000 }, (_, i) => ({ i, note: 'y'.repeat(80) }));
		const { items: out } = boundArrayElements(items, (slice) => ({ rows: slice }));
		const serialized = JSON.stringify({ rows: out });
		expect(() => JSON.parse(serialized)).not.toThrow();
	});

	test('a single element whose envelope alone exceeds budget yields zero items, not a crash', () => {
		const monster = { note: 'z'.repeat(1_000_000) };
		const { items: out, truncated } = boundArrayElements([monster], (slice) => ({ rows: slice }));
		expect(out).toEqual([]);
		expect(truncated).toBe(true);
	});

	/**
	 * `keep: 'tail'` is what `portfolio.performance` and `market.priceHistory` use, because their
	 * points are ordered oldest -> newest — dropping from the tail (the default) would delete the
	 * MOST RECENT point, which is exactly the I3 bug this option exists to close.
	 */
	describe('keep option', () => {
		test("default ('head'): drops the NEWEST elements, keeps the OLDEST — unchanged legacy behavior", () => {
			const items = Array.from({ length: 5000 }, (_, i) => ({ i, note: 'x'.repeat(50) }));
			const { items: out } = boundArrayElements(items, (slice) => ({ rows: slice }));
			expect(out[0]?.i).toBe(0);
			expect(out[out.length - 1]?.i).toBeLessThan(items.length - 1);
		});

		test("'tail': drops the OLDEST elements, keeps the NEWEST — the last element always survives", () => {
			const items = Array.from({ length: 5000 }, (_, i) => ({ i, note: 'x'.repeat(50) }));
			const { items: out, truncated } = boundArrayElements(items, (slice) => ({ rows: slice }), { keep: 'tail' });
			expect(truncated).toBe(true);
			expect(out.length).toBeGreaterThan(0);
			expect(out.length).toBeLessThan(items.length);
			// It is a SUFFIX ending at the true last element — the newest point is never dropped.
			expect(out).toEqual(items.slice(items.length - out.length));
			expect(out[out.length - 1]?.i).toBe(items.length - 1);
			expect(JSON.stringify({ rows: out }).length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
		});

		test("'tail': returns every element untruncated when the envelope already fits", () => {
			const items = [1, 2, 3];
			const { items: out, truncated } = boundArrayElements(items, (slice) => ({ values: slice }), {
				keep: 'tail'
			});
			expect(out).toEqual(items);
			expect(truncated).toBe(false);
		});
	});
});

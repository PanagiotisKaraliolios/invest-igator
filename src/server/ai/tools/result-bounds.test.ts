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
});

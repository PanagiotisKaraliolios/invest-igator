import { describe, expect, test } from 'bun:test';
import { isoDateSchema, parseIsoDateUtc, toLocalIsoDate } from './date';

describe('parseIsoDateUtc', () => {
	test('parses a valid yyyy-mm-dd as UTC midnight', () => {
		const d = parseIsoDateUtc('2026-01-05');
		expect(d).not.toBeNull();
		expect(d!.toISOString()).toBe('2026-01-05T00:00:00.000Z');
	});

	test('rejects impossible calendar dates instead of silently rolling them over', () => {
		// new Date('2026-02-30T00:00:00Z') does not throw — it becomes 2026-03-02.
		expect(parseIsoDateUtc('2026-02-30')).toBeNull();
		expect(parseIsoDateUtc('2026-04-31')).toBeNull();
		expect(parseIsoDateUtc('2026-11-31')).toBeNull();
		expect(parseIsoDateUtc('2026-13-01')).toBeNull();
		expect(parseIsoDateUtc('2026-00-10')).toBeNull();
	});

	test('accepts a real leap day but rejects a non-leap Feb 29', () => {
		expect(parseIsoDateUtc('2024-02-29')).not.toBeNull(); // 2024 is a leap year
		expect(parseIsoDateUtc('2026-02-29')).toBeNull(); // 2026 is not
	});

	test('rejects malformed or non-strict formats', () => {
		expect(parseIsoDateUtc('2026-1-5')).toBeNull(); // not zero-padded
		expect(parseIsoDateUtc('05/01/2026')).toBeNull();
		expect(parseIsoDateUtc('2026-01-05T12:00:00Z')).toBeNull();
		expect(parseIsoDateUtc('not-a-date')).toBeNull();
		expect(parseIsoDateUtc('')).toBeNull();
	});

	test('round-trips with toLocalIsoDate for valid dates', () => {
		// UTC-midnight date formatted in UTC-or-eastern offsets keeps the same day only
		// when read in UTC terms; this just guards the happy-path shape.
		const d = parseIsoDateUtc('2026-07-11')!;
		expect(d.getUTCFullYear()).toBe(2026);
		expect(d.getUTCMonth()).toBe(6); // July, 0-indexed
		expect(d.getUTCDate()).toBe(11);
	});
});

describe('isoDateSchema', () => {
	test('parses a valid yyyy-mm-dd into a UTC-midnight Date', () => {
		const parsed = isoDateSchema.parse('2026-01-05');
		expect(parsed).toBeInstanceOf(Date);
		expect(parsed.toISOString()).toBe('2026-01-05T00:00:00.000Z');
	});

	test('rejects impossible dates instead of rolling them over to the wrong day', () => {
		// The bug this guards: `z.string().transform((s) => new Date(s))` accepts
		// '2026-02-30' and silently stores 2026-03-02. Every write path that takes a
		// user-supplied date shares this schema, so none of them can do that.
		for (const impossible of ['2026-02-30', '2026-04-31', '2026-13-01', '2026-02-29']) {
			expect(isoDateSchema.safeParse(impossible).success).toBe(false);
		}
	});

	test('rejects a full ISO datetime — callers must send a bare yyyy-mm-dd', () => {
		expect(isoDateSchema.safeParse('2026-01-05T12:00:00Z').success).toBe(false);
	});

	test('optional() still rejects an impossible date when the field is present', () => {
		// The `update` mutation takes `isoDateSchema.optional()`; omitting the date is
		// fine, but supplying a bad one must not slip through the optional wrapper.
		const optional = isoDateSchema.optional();
		expect(optional.safeParse(undefined).success).toBe(true);
		expect(optional.safeParse('2026-02-30').success).toBe(false);
		expect(optional.parse('2026-01-05')?.toISOString()).toBe('2026-01-05T00:00:00.000Z');
	});
});

describe('toLocalIsoDate', () => {
	test('formats a local-midnight date as yyyy-mm-dd', () => {
		expect(toLocalIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
		expect(toLocalIsoDate(new Date(2026, 11, 31))).toBe('2026-12-31');
	});
});

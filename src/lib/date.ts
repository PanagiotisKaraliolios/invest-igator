import { z } from 'zod';

/** Format a Date as a local-time `yyyy-mm-dd` string (uses local getFullYear/getMonth/getDate). */
export function toLocalIsoDate(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Parse a strict `yyyy-mm-dd` calendar date as UTC midnight, or return `null`.
 *
 * `new Date('2026-02-30T00:00:00Z')` does NOT throw or return `Invalid Date` — the
 * Date constructor silently rolls overflowed days forward, so Feb 30 becomes Mar 2.
 * A plain `Number.isNaN(date.getTime())` guard therefore accepts impossible dates and
 * stores a different, wrong day. This validates the format and requires the parsed
 * date to round-trip back to the input, rejecting any rolled-over value.
 */
export function parseIsoDateUtc(value: string): Date | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const date = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(date.getTime())) return null;
	// Overflowed days (e.g. 2026-02-30 -> 2026-03-02) no longer match the input.
	if (date.toISOString().slice(0, 10) !== value) return null;
	return date;
}

/**
 * Zod schema for a transaction date: accepts a bare `yyyy-mm-dd` string and yields a
 * UTC-midnight `Date`, rejecting impossible calendar dates rather than rolling them over.
 *
 * Every write path that accepts a user-supplied date must use this. Each entry point that
 * hand-rolled `z.string().transform((s) => new Date(s))` instead was a way to silently
 * store the wrong day; sharing one schema keeps a new one from drifting back.
 */
export const isoDateSchema = z
	.string()
	.refine((s) => parseIsoDateUtc(s) !== null, {
		message: 'Invalid date — expected a real yyyy-mm-dd calendar date.'
	})
	.transform((s) => parseIsoDateUtc(s) as Date);

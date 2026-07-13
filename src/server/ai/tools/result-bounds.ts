import { MAX_TOOL_RESULT_TOKENS } from '@/server/ai/guardrails';

/**
 * Every tool that returns an array whose LENGTH or ELEMENT SIZE is not fully determined by a
 * small, schema-validated input (e.g. `transactions.search`'s rows carry a user-entered `note`
 * with no DB-level length cap; `watchlist.list`'s `description` is the same) needs a runtime
 * guarantee that the serialized result stays under `MAX_TOOL_RESULT_TOKENS` (guardrails.ts) —
 * a static input clamp (`limit <= 100`, `days <= 400`, ...) narrows the common case but cannot
 * bound content the tool does not control.
 *
 * `4 chars/token` is a rule of thumb for ENGLISH PROSE. It does not hold for our payloads: tool
 * results are JSON dominated by full-precision doubles, cuid ids and ISO dates, and BPE tokenizers
 * (measured with the gpt-4o / o200k_base encoding used by `gpt-tokenizer`, the real tokenizer
 * `registry.test.ts` asserts against) tokenize that content at 2.0–2.8 chars/token, not 4 —
 * median ~2.7, MEASURED MINIMUM 2.03 across `portfolio.performance`, `transactions.search`,
 * `portfolio.structure` and `watchlist.list` at their own schema maxima. Budgeting on 4 let every
 * one of those tools ship 1.2x–1.8x over `MAX_TOOL_RESULT_TOKENS` while its own test asserted
 * (with the same wrong proxy) that it was in budget — see the Task 10 fix-wave report.
 *
 * `CHARS_PER_TOKEN = 2` is chosen, not 2.7 (the measured median), so that the measured MINIMUM
 * (2.03) still fits comfortably inside the char budget this constant derives — i.e. every real
 * payload this dense or denser stays under `MAX_TOOL_RESULT_TOKENS` even though `MAX_TOOL_RESULT_CHARS`
 * only ever measures characters, never real tokens. Do NOT "optimise" this back toward 4 chars/token
 * to fit more content in — that reintroduces the exact bug this constant exists to close, and
 * `registry.test.ts` re-derives the real BPE token count (not this proxy) specifically to catch it.
 */
const CHARS_PER_TOKEN = 2;

/** Conservative character budget for one tool result, derived from MAX_TOOL_RESULT_TOKENS. */
export const MAX_TOOL_RESULT_CHARS = MAX_TOOL_RESULT_TOKENS * CHARS_PER_TOKEN;

/**
 * Bounds an array-shaped tool result to fit under `MAX_TOOL_RESULT_CHARS`.
 *
 * This NEVER truncates the serialized JSON string — doing so cuts mid-record, corrupts the
 * JSON, and silently biases the window (see guardrails.ts / the Task 10 brief). Instead it
 * drops whole ARRAY ELEMENTS from one end, re-measuring the REAL serialized size of the
 * candidate envelope at each length via `render` (rather than estimating per-element cost),
 * so the bound holds regardless of how large any individual element happens to be.
 *
 * Binary-searches the largest prefix/suffix of `items` whose rendered envelope fits. If even a
 * single element's envelope does not fit, returns zero items — an honest, uncorrupted (if
 * unhelpful) result, with `truncated: true` so the caller surfaces it rather than silently
 * dropping everything.
 *
 * `options.keep` picks WHICH end survives:
 *   - `'head'` (default) — keep the largest fitting PREFIX, drop from the tail. Correct for
 *     data that is already ordered "most important/most recent first": `transactions.search`
 *     (date desc), `watchlist.list` (starred desc), `goals.list`, `portfolio.structure`
 *     (value desc — drops the smallest positions, which is right).
 *   - `'tail'` — keep the largest fitting SUFFIX, drop from the head. Required for series
 *     ordered oldest -> newest (`portfolio.performance.points`, `market.priceHistory.points`):
 *     dropping from the tail there would delete the MOST RECENT data point while a
 *     twr/mwr figure computed on the true window endpoints still claims to run to today —
 *     a wrong answer, not merely a truncated one. `'tail'` drops the OLDEST elements instead,
 *     so the most recent point always survives truncation.
 *
 * Callers MUST put `truncated` (or an equivalently named field) in their `outputSchema` and
 * return it — an unsurfaced truncation is exactly the "the model confidently tells the user
 * it saw everything" bug this exists to prevent.
 */
export function boundArrayElements<T>(
	items: readonly T[],
	render: (slice: readonly T[]) => unknown,
	options?: { keep?: 'head' | 'tail' }
): { items: T[]; truncated: boolean } {
	const keep = options?.keep ?? 'head';
	const slice = keep === 'head' ? (n: number) => items.slice(0, n) : (n: number) => items.slice(items.length - n);
	const fits = (n: number): boolean => JSON.stringify(render(slice(n))).length <= MAX_TOOL_RESULT_CHARS;

	if (fits(items.length)) {
		return { items: items.slice(), truncated: false };
	}

	let lo = 0;
	let hi = items.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (fits(mid)) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}
	return { items: slice(lo), truncated: true };
}

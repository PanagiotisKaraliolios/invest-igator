import { MAX_TOOL_RESULT_TOKENS } from '@/server/ai/guardrails';

/**
 * Every tool that returns an array whose LENGTH or ELEMENT SIZE is not fully determined by a
 * small, schema-validated input (e.g. `transactions.search`'s rows carry a user-entered `note`
 * with no DB-level length cap; `watchlist.list`'s `description` is the same) needs a runtime
 * guarantee that the serialized result stays under `MAX_TOOL_RESULT_TOKENS` (guardrails.ts) —
 * a static input clamp (`limit <= 100`, `days <= 400`, ...) narrows the common case but cannot
 * bound content the tool does not control.
 *
 * `~4 chars/token` is the same rule of thumb `guardrails.ts` documents next to
 * `MAX_TOOL_RESULT_TOKENS` — reused here, not re-derived, so the two numbers cannot drift apart.
 */
const CHARS_PER_TOKEN = 4;

/** Conservative character budget for one tool result, derived from MAX_TOOL_RESULT_TOKENS. */
export const MAX_TOOL_RESULT_CHARS = MAX_TOOL_RESULT_TOKENS * CHARS_PER_TOKEN;

/**
 * Bounds an array-shaped tool result to fit under `MAX_TOOL_RESULT_CHARS`.
 *
 * This NEVER truncates the serialized JSON string — doing so cuts mid-record, corrupts the
 * JSON, and silently biases the window (see guardrails.ts / the Task 10 brief). Instead it
 * drops whole ARRAY ELEMENTS from the tail, re-measuring the REAL serialized size of the
 * candidate envelope at each length via `render` (rather than estimating per-element cost),
 * so the bound holds regardless of how large any individual element happens to be.
 *
 * Binary-searches the largest prefix of `items` whose rendered envelope fits. If even a
 * single element's envelope does not fit, returns zero items — an honest, uncorrupted (if
 * unhelpful) result, with `truncated: true` so the caller surfaces it rather than silently
 * dropping everything.
 *
 * Callers MUST put `truncated` (or an equivalently named field) in their `outputSchema` and
 * return it — an unsurfaced truncation is exactly the "the model confidently tells the user
 * it saw everything" bug this exists to prevent.
 */
export function boundArrayElements<T>(
	items: readonly T[],
	render: (slice: readonly T[]) => unknown
): { items: T[]; truncated: boolean } {
	const fits = (n: number): boolean => JSON.stringify(render(items.slice(0, n))).length <= MAX_TOOL_RESULT_CHARS;

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
	return { items: items.slice(0, lo), truncated: true };
}

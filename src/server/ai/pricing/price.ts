import { createHash } from 'node:crypto';

import snapshot from './models.snapshot.json';

/**
 * Token buckets for one provider call.
 *
 * `inputTokens` is the TOTAL prompt token count. `cacheReadTokens` and `cacheWriteTokens`
 * are SUBSETS of it — the non-cached remainder is what gets the full input rate.
 */
export type TokenUsage = {
	inputTokens: number | null;
	outputTokens: number | null;
	cacheReadTokens: number | null;
	cacheWriteTokens: number | null;
};

/** models.dev cost, in USD per MILLION tokens. (LiteLLM's is per token — a 1e6 error.) */
type ModelCost = {
	input: number;
	output: number;
	cacheRead?: number;
	cacheWrite?: number;
};

type Snapshot = {
	license: string;
	models: Record<string, ModelCost>;
	source: string;
	unit: string;
};

const SNAPSHOT = snapshot as Snapshot;

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

function canonicalise(value: JsonValue): JsonValue {
	if (Array.isArray(value)) return value.map(canonicalise);
	if (value !== null && typeof value === 'object') {
		const out: { [k: string]: JsonValue } = {};
		for (const key of Object.keys(value).sort()) {
			const child = value[key];
			if (child !== undefined) out[key] = canonicalise(child);
		}
		return out;
	}
	return value;
}

/** Deterministic serialisation: sorted keys, no whitespace. */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(canonicalise(value as JsonValue));
}

/**
 * Content address of the price catalogue. Written to every `AiCall.priceSnapshotId`
 * so historical rows can be re-priced reproducibly.
 *
 * Hashed over the canonical re-serialisation rather than the raw file bytes: the JSON is
 * inlined by the bundler, so there is no file to read at runtime — and this way Biome
 * reformatting the snapshot cannot change the id.
 */
export const PRICE_SNAPSHOT_ID: string = `sha256:${createHash('sha256')
	.update(canonicalJson(SNAPSHOT), 'utf8')
	.digest('hex')}`;

/**
 * Rates are held as picoUSD (1e-12 USD) per token: `usdPerMillion * 1e6`, an exact integer
 * for every rate in the catalogue. Rounding the rate straight to nanoUSD/token would truncate
 * any sub-$0.001/1M rate to zero.
 */
function toPicoPerToken(usdPerMillion: number): bigint {
	return BigInt(Math.round(usdPerMillion * 1_000_000));
}

type Rates = { input: bigint; output: bigint; cacheRead: bigint; cacheWrite: bigint };

const RATES: ReadonlyMap<string, Rates> = new Map(
	Object.entries(SNAPSHOT.models).map(([id, cost]) => [
		id,
		{
			// Azure/OpenAI publish no cache_write rate — OpenAI bills cache writes at the
			// standard input rate. Falling back to `input` never under-bills.
			cacheRead: toPicoPerToken(cost.cacheRead ?? cost.input),
			cacheWrite: toPicoPerToken(cost.cacheWrite ?? cost.input),
			input: toPicoPerToken(cost.input),
			output: toPicoPerToken(cost.output)
		}
	])
);

/** Synthetic most-expensive model. Used only to size a reservation for an unpriced model. */
const WORST_CASE: Rates = (() => {
	const all = [...RATES.values()];
	const max = (pick: (r: Rates) => bigint): bigint => all.reduce((acc, r) => (pick(r) > acc ? pick(r) : acc), 0n);
	const input = max((r) => r.input);
	const output = max((r) => r.output);
	return { cacheRead: input, cacheWrite: input, input, output };
})();

/**
 * Every token leaf is nullable and providers occasionally emit NaN, a float or a negative.
 * BigInt() THROWS on all three — and a throw here aborts settle() and leaks the reservation.
 * Never let one reach BigInt().
 */
function count(value: number | null): bigint {
	if (value === null || !Number.isFinite(value)) return 0n;
	return BigInt(Math.max(0, Math.trunc(value)));
}

function picoToNano(picoUsd: bigint): bigint {
	return (picoUsd + 500n) / 1000n; // round half up; all inputs are non-negative
}

/**
 * @returns null for an UNKNOWN model. NEVER 0n — a zero fallback means the platform
 *          silently eats the bill. The caller writes `pricingStatus: UNKNOWN_MODEL`
 *          and `costNanoUsd: null`.
 */
export function price(resolvedModel: string, usage: TokenUsage): { nanoUsd: bigint } | null {
	const rates = RATES.get(resolvedModel);
	if (rates === undefined) return null;

	const inputTotal = count(usage.inputTokens);
	const cacheRead = count(usage.cacheReadTokens);
	const cacheWrite = count(usage.cacheWriteTokens);
	const output = count(usage.outputTokens);

	// Saturating: a provider that reports inputTokens EXCLUDING the cache buckets would
	// otherwise drive this negative. bigint has no wraparound, but a negative bill is worse.
	const cached = cacheRead + cacheWrite;
	const nonCached = inputTotal > cached ? inputTotal - cached : 0n;

	const picoUsd =
		nonCached * rates.input + cacheRead * rates.cacheRead + cacheWrite * rates.cacheWrite + output * rates.output;

	return { nanoUsd: picoToNano(picoUsd) };
}

/**
 * Upper bound on what a call can cost, for the quota reservation (Task 8).
 * All input is charged at the full uncached rate and all output at `maxOutputTokens`,
 * which the guardrail middleware forces — so the ceiling is never unbounded.
 */
export function estimateCeilingNanoUsd(
	resolvedModel: string,
	estimatedInputTokens: number,
	maxOutputTokens: number
): bigint {
	const rates = RATES.get(resolvedModel) ?? WORST_CASE;
	const picoUsd = count(estimatedInputTokens) * rates.input + count(maxOutputTokens) * rates.output;
	return picoToNano(picoUsd);
}

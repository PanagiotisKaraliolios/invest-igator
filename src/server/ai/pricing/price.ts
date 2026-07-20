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
	/**
	 * Long-context / tiered pricing, from models.dev's `tiers[0]` (verified against the live
	 * payload for gpt-5.4 and gemini-2.5-pro — `tier.size` is the threshold, in tokens).
	 * This is a STEP function, not marginal: once the call's total prompt token count exceeds
	 * `contextThreshold`, the ENTIRE call is billed at these rates instead of the base ones.
	 */
	contextThreshold?: number;
	tieredInput?: number;
	tieredOutput?: number;
	tieredCacheRead?: number;
	tieredCacheWrite?: number;
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

/** The above-threshold rates from `ModelCost.tiered*`. See `ModelCost.contextThreshold`. */
type TieredRates = { threshold: bigint; input: bigint; output: bigint; cacheRead: bigint; cacheWrite: bigint };

type Rates = { input: bigint; output: bigint; cacheRead: bigint; cacheWrite: bigint; tiered?: TieredRates };

const RATES: ReadonlyMap<string, Rates> = new Map(
	Object.entries(SNAPSHOT.models).map(([id, cost]) => {
		const tiered: TieredRates | undefined =
			cost.contextThreshold === undefined
				? undefined
				: {
						// Same never-under-bill fallback chain as the base rates, one tier up:
						// missing tiered cache rate -> tiered input rate -> base cache rate -> base input.
						cacheRead: toPicoPerToken(
							cost.tieredCacheRead ?? cost.tieredInput ?? cost.cacheRead ?? cost.input
						),
						cacheWrite: toPicoPerToken(
							cost.tieredCacheWrite ?? cost.tieredInput ?? cost.cacheWrite ?? cost.input
						),
						input: toPicoPerToken(cost.tieredInput ?? cost.input),
						output: toPicoPerToken(cost.tieredOutput ?? cost.output),
						threshold: BigInt(cost.contextThreshold)
					};
		return [
			id,
			{
				// Azure/OpenAI publish no cache_write rate — OpenAI bills cache writes at the
				// standard input rate. Falling back to `input` never under-bills.
				cacheRead: toPicoPerToken(cost.cacheRead ?? cost.input),
				cacheWrite: toPicoPerToken(cost.cacheWrite ?? cost.input),
				input: toPicoPerToken(cost.input),
				output: toPicoPerToken(cost.output),
				tiered
			}
		];
	})
);

/**
 * Highest possible per-token input-side rate for `rates`: the base input rate, the base
 * cache-write rate (25% above input for Anthropic models — see C2), and — if the model has
 * long-context tiers — the tiered equivalents of both. A ceiling must use this, never `input`
 * alone, or a cache-write-heavy or long-context call can bill above what was reserved.
 */
function maxInputRate(rates: Rates): bigint {
	let max = rates.input > rates.cacheWrite ? rates.input : rates.cacheWrite;
	if (rates.tiered !== undefined) {
		if (rates.tiered.input > max) max = rates.tiered.input;
		if (rates.tiered.cacheWrite > max) max = rates.tiered.cacheWrite;
	}
	return max;
}

/** Highest possible per-token output rate: base, or the tiered rate if the model has one. */
function maxOutputRate(rates: Rates): bigint {
	const tieredOutput = rates.tiered?.output ?? 0n;
	return rates.output > tieredOutput ? rates.output : tieredOutput;
}

/** Synthetic most-expensive model. Used only to size a reservation for an unpriced model. */
const WORST_CASE: Rates = (() => {
	const all = [...RATES.values()];
	const max = (pick: (r: Rates) => bigint): bigint => all.reduce((acc, r) => (pick(r) > acc ? pick(r) : acc), 0n);
	const input = max(maxInputRate);
	const output = max(maxOutputRate);
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

	// Long-context pricing is a step function on TOTAL prompt size, not marginal: once
	// inputTotal crosses the threshold the whole call — cached and non-cached alike — bills
	// at the tiered rates.
	const active = rates.tiered !== undefined && inputTotal > rates.tiered.threshold ? rates.tiered : rates;

	const picoUsd =
		nonCached * active.input +
		cacheRead * active.cacheRead +
		cacheWrite * active.cacheWrite +
		output * active.output;

	return { nanoUsd: picoToNano(picoUsd) };
}

/**
 * Upper bound on what a call can cost, for the quota reservation (Task 8).
 * All input is charged at the highest per-token rate the model can possibly bill it at —
 * `max(input, cacheWrite)`, and, for a model with long-context tiers, the tiered equivalents
 * of both — and all output at `maxOutputTokens` at the highest possible output rate. The
 * guardrail middleware forces `maxOutputTokens`, so the ceiling is never unbounded. This must
 * never optimistically assume the call stays under the input rate or under the tier threshold:
 * `price()` can legitimately bill at any of these rates, so the ceiling has to dominate all of
 * them, not just the cheapest one.
 */
export function estimateCeilingNanoUsd(
	resolvedModel: string,
	estimatedInputTokens: number,
	maxOutputTokens: number
): bigint {
	const rates = RATES.get(resolvedModel) ?? WORST_CASE;
	const picoUsd = count(estimatedInputTokens) * maxInputRate(rates) + count(maxOutputTokens) * maxOutputRate(rates);
	return picoToNano(picoUsd);
}

import { describe, expect, test } from 'bun:test';

import { canonicalJson, estimateCeilingNanoUsd, PRICE_SNAPSHOT_ID, price, type TokenUsage } from './price';

const EMPTY: TokenUsage = {
	cacheReadTokens: null,
	cacheWriteTokens: null,
	inputTokens: null,
	outputTokens: null
};

describe('price', () => {
	// gpt-5.4-mini: $0.75/1M in, $4.50/1M out.
	// 1000 * 0.75/1e6 = $0.00075 ; 500 * 4.50/1e6 = $0.00225 ; total $0.0030 = 3_000_000 nanoUSD.
	test('prices a known model exactly', () => {
		const result = price('gpt-5.4-mini', { ...EMPTY, inputTokens: 1000, outputTokens: 500 });
		expect(result).not.toBeNull();
		expect(result?.nanoUsd).toBe(3_000_000n);
	});

	// cacheRead is $0.075/1M — 10x cheaper than the $0.75/1M input rate.
	// inputTokens is the TOTAL prompt; cacheRead is a subset of it.
	// 1000 non-cached * 750_000 pico + 2000 cached * 75_000 pico + 500 out * 4_500_000 pico
	//   = 3_150_000_000 pico = 3_150_000 nanoUSD.
	// Billing those 2000 tokens at the input rate instead yields 4_500_000n — a 43% over-bill
	// on every turn of a chatbot with a long cached system prompt.
	test('cacheReadTokens is priced at the cache rate, not the input rate', () => {
		const cached = price('gpt-5.4-mini', {
			...EMPTY,
			cacheReadTokens: 2000,
			inputTokens: 3000,
			outputTokens: 500
		});
		const naive = price('gpt-5.4-mini', { ...EMPTY, inputTokens: 3000, outputTokens: 500 });

		expect(cached?.nanoUsd).toBe(3_150_000n);
		expect(naive?.nanoUsd).toBe(4_500_000n);
		expect((naive?.nanoUsd ?? 0n) - (cached?.nanoUsd ?? 0n)).toBe(1_350_000n);
	});

	// Both cache buckets at once: the non-cached remainder is input - read - write.
	// 1000 nonCached * 750_000 + 2000 read * 75_000 + 1000 write * 750_000 (no cacheWrite rate
	//   published -> input fallback) + 0 out = 1_650_000_000 pico = 1_650_000 nanoUSD.
	test('cacheRead and cacheWrite are both subtracted from the input total', () => {
		const result = price('gpt-5.4-mini', {
			...EMPTY,
			cacheReadTokens: 2000,
			cacheWriteTokens: 1000,
			inputTokens: 4000
		});
		expect(result?.nanoUsd).toBe(1_650_000n);
	});

	// Defensive: some providers report input_tokens EXCLUDING the cached buckets. If Task 7's
	// mapper ever feeds us that, the remainder goes negative. It must saturate at zero, never
	// wrap to a colossal bigint or produce a negative bill.
	test('cached tokens exceeding the input total saturate at zero, never go negative', () => {
		const result = price('gpt-5.4-mini', {
			...EMPTY,
			cacheReadTokens: 5000,
			inputTokens: 1000
		});
		// 0 non-cached + 5000 * 75_000 pico = 375_000_000 pico = 375_000 nanoUSD.
		expect(result?.nanoUsd).toBe(375_000n);
		expect((result?.nanoUsd ?? -1n) >= 0n).toBe(true);
	});

	test('every token field null yields 0n, not NaN', () => {
		const result = price('gpt-5.4-mini', EMPTY);
		expect(result?.nanoUsd).toBe(0n);
	});

	// BigInt() throws on a non-integer or NaN. A provider emitting NaN/-1/1.5 must not crash
	// the billing path — that would abort the settle() and leak the reservation.
	// inputTokens: -5 clamps to 0, cacheReadTokens: NaN clamps to 0, outputTokens: 1.9 truncs
	// to 1 -> 1 * 4_500_000 pico = 4_500_000 pico = 4_500 nanoUSD.
	test('NaN, negative and fractional token counts are coerced, never thrown on', () => {
		expect(
			price('gpt-5.4-mini', {
				...EMPTY,
				cacheReadTokens: Number.NaN,
				inputTokens: -5,
				outputTokens: 1.9
			})?.nanoUsd
		).toBe(4_500n);
	});

	// A 0n fallback would mean the platform silently eats the bill for a model we cannot price.
	test('an UNKNOWN model returns null, never 0n', () => {
		expect(price('definitely-not-a-model', { ...EMPTY, inputTokens: 1000 })).toBeNull();
	});

	// gpt-5.4-nano input is $0.20/1M = 0.2 MICRO-USD/token. In microUSD integers this truncates
	// to zero and we silently under-bill to nothing. In nanoUSD it is exactly 200.
	test('BigInt precision: one gpt-5.4-nano input token does not truncate to zero', () => {
		const result = price('gpt-5.4-nano', { ...EMPTY, inputTokens: 1 });
		expect(result?.nanoUsd).toBe(200n);
	});

	// Azure/OpenAI publish no cache_write rate: OpenAI bills cache writes at the input rate.
	test('cacheWrite falls back to the input rate when the catalogue omits it', () => {
		const result = price('gpt-5.4-mini', { ...EMPTY, cacheWriteTokens: 1000, inputTokens: 1000 });
		expect(result?.nanoUsd).toBe(750_000n);
	});

	// Anthropic does publish one: claude-haiku-4-5 cache_write is $1.25/1M vs $1.00/1M input.
	test('cacheWrite uses its own rate when the catalogue has it', () => {
		const result = price('claude-haiku-4-5', {
			...EMPTY,
			cacheWriteTokens: 1000,
			inputTokens: 1000
		});
		expect(result?.nanoUsd).toBe(1_250_000n);
	});
});

describe('estimateCeilingNanoUsd', () => {
	// 10_000 * 750_000 pico + 2_000 * 4_500_000 pico = 16_500_000_000 pico = 16_500_000 nanoUSD.
	test('ceils estimated input + forced max output at full (uncached) rates', () => {
		expect(estimateCeilingNanoUsd('gpt-5.4-mini', 10_000, 2_000)).toBe(16_500_000n);
	});

	// Unknown model must NOT reserve zero — that lets an at-limit user through.
	// Worst case in the snapshot: $5/1M in and $25/1M out (claude-opus-4-8).
	// 10_000 * 5e6 + 2_000 * 25e6 = 100e9 pico = 100_000_000 nanoUSD.
	test('an unknown model falls back to the worst case in the catalogue', () => {
		expect(estimateCeilingNanoUsd('definitely-not-a-model', 10_000, 2_000)).toBe(100_000_000n);
	});

	// The unknown-model ceiling must dominate every known model's ceiling, or the fallback
	// under-reserves for whichever model is actually used.
	test('the worst-case ceiling is >= every known model at the same token counts', () => {
		const worst = estimateCeilingNanoUsd('definitely-not-a-model', 10_000, 2_000);
		for (const model of ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'claude-opus-4-8']) {
			expect(estimateCeilingNanoUsd(model, 10_000, 2_000) <= worst).toBe(true);
		}
	});
});

describe('PRICE_SNAPSHOT_ID', () => {
	test('is a sha256 digest', () => {
		expect(PRICE_SNAPSHOT_ID).toMatch(/^sha256:[0-9a-f]{64}$/);
	});

	test('canonicalJson is key-order independent but content sensitive', () => {
		// Built via Object.fromEntries (not an object literal) so Biome's useSortedKeys assist
		// can't silently re-sort it back to alphabetical and defeat the point of this test.
		const insertedBThenA = Object.fromEntries([
			['b', 2],
			['a', 1]
		]);
		expect(canonicalJson(insertedBThenA)).toBe(canonicalJson({ a: 1, b: 2 }));
		expect(canonicalJson({ a: 1, b: 2 })).not.toBe(canonicalJson({ a: 1, b: 3 }));
	});
});

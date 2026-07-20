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

	// gpt-5.4's real models.dev threshold is 272_000, not the ~200k a naive reading of "long
	// context" might assume (gemini-2.5-pro's is exactly 200_000 — the two differ). Tiered
	// input is $5/1M, tiered output $22.5/1M (both exactly 2x base).
	// nonCached 300_000 * 5_000_000 pico + 1_000 out * 22_500_000 pico
	//   = 1_500_000_000_000 + 22_500_000_000 = 1_522_500_000_000 pico = 1_522_500_000 nanoUSD.
	// Billed at the base rate this would be 640_000_000n + 15_000_000n*1000/1e6-ish — far lower;
	// this is the case C1 describes as a 49.7%-under-bill.
	test('a call above the long-context threshold bills at the tiered rate', () => {
		const result = price('gpt-5.4', { ...EMPTY, inputTokens: 300_000, outputTokens: 1_000 });
		expect(result?.nanoUsd).toBe(1_522_500_000n);
	});

	// Same model, same shape, but under the real 272_000 threshold: must stay at the base rate.
	// 200_000 * 2_500_000 pico + 1_000 * 15_000_000 pico = 515_000_000_000 pico = 515_000_000 nanoUSD.
	test('a call below the long-context threshold bills at the base rate', () => {
		const result = price('gpt-5.4', { ...EMPTY, inputTokens: 200_000, outputTokens: 1_000 });
		expect(result?.nanoUsd).toBe(515_000_000n);
	});

	// The threshold is exclusive (models.dev's tier applies once context EXCEEDS the size, not
	// at it): exactly 272_000 tokens of input must still bill at the base rate.
	test('a call exactly at the long-context threshold still bills at the base rate', () => {
		const result = price('gpt-5.4', { ...EMPTY, inputTokens: 272_000, outputTokens: 0 });
		expect(result?.nanoUsd).toBe(680_000_000n);
	});
});

describe('estimateCeilingNanoUsd', () => {
	// 10_000 * 750_000 pico + 2_000 * 4_500_000 pico = 16_500_000_000 pico = 16_500_000 nanoUSD.
	test('ceils estimated input + forced max output at full (uncached) rates', () => {
		expect(estimateCeilingNanoUsd('gpt-5.4-mini', 10_000, 2_000)).toBe(16_500_000n);
	});

	// Unknown model must NOT reserve zero — that lets an at-limit user through.
	// Worst case in the snapshot is now claude-opus-4-8's cacheWrite rate ($6.25/1M — 25% above
	// its own $5/1M input rate, see C2) for input, and its $25/1M output rate. No tiered rate in
	// the catalogue beats $6.25/1M on the input side (gpt-5.4 tiered input is only $5/1M).
	// 10_000 * 6.25e6 + 2_000 * 25e6 = 62_500_000_000 + 50_000_000_000 = 112_500_000_000 pico
	//   = 112_500_000 nanoUSD.
	test('an unknown model falls back to the worst case in the catalogue', () => {
		expect(estimateCeilingNanoUsd('definitely-not-a-model', 10_000, 2_000)).toBe(112_500_000n);
	});

	// The unknown-model ceiling must dominate every known model's ceiling, or the fallback
	// under-reserves for whichever model is actually used.
	test('the worst-case ceiling is >= every known model at the same token counts', () => {
		const worst = estimateCeilingNanoUsd('definitely-not-a-model', 10_000, 2_000);
		for (const model of ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'claude-opus-4-8']) {
			expect(estimateCeilingNanoUsd(model, 10_000, 2_000) <= worst).toBe(true);
		}
	});

	// C2: cacheWrite is 25% above input for every Anthropic model. A ceiling built from
	// `rates.input` alone reserves 50_000_000n here while the real bill is 62_500_000n — a 25%
	// breach. This is the exact scenario from the C2 bug report.
	test('the ceiling for a cache-write-heavy call is not less than the actual bill (claude-opus-4-8)', () => {
		const ceiling = estimateCeilingNanoUsd('claude-opus-4-8', 10_000, 0);
		const actual = price('claude-opus-4-8', { ...EMPTY, cacheWriteTokens: 10_000, inputTokens: 10_000 });
		expect(ceiling).toBe(62_500_000n);
		expect(actual?.nanoUsd).toBe(62_500_000n);
		expect((actual?.nanoUsd ?? -1n) <= ceiling).toBe(true);
	});

	// C1: a ceiling built only from the base rate reserves far less than a long-context call can
	// actually cost. The ceiling must assume the WORST case — the tiered rate — even though the
	// caller only estimated `estimatedInputTokens`, because it cannot know in advance whether the
	// eventual call crosses the threshold.
	test('the ceiling for a long-context call is not less than the actual tiered bill (gpt-5.4)', () => {
		const ceiling = estimateCeilingNanoUsd('gpt-5.4', 300_000, 1_000);
		const actual = price('gpt-5.4', { ...EMPTY, inputTokens: 300_000, outputTokens: 1_000 });
		expect(ceiling).toBe(1_522_500_000n);
		expect(actual?.nanoUsd).toBe(1_522_500_000n);
		expect((actual?.nanoUsd ?? -1n) <= ceiling).toBe(true);
	});

	// The reservation invariant Task 8's quota depends on, as a property: for every priceable
	// model and a battery of adversarial usage shapes (cache-write-heavy, long-context,
	// output-heavy, and all three combined), the actual bill must never exceed the ceiling
	// computed from the same (inputTokens, outputTokens) the caller reserved against.
	// This is the test that would have caught both C1 and C2: before the fix, the gpt-5.4
	// long-context shape and every cache-write shape on claude-opus-4-8 violated it.
	test('invariant: price() never exceeds estimateCeilingNanoUsd() for any priced model and usage shape', () => {
		const models = [
			'gpt-5.4',
			'gpt-5.4-mini',
			'gpt-5.4-nano',
			'claude-opus-4-8',
			'claude-sonnet-4-5',
			'claude-haiku-4-5',
			'gemini-2.5-pro',
			'gemini-3.5-flash',
			'gemini-3.1-flash-lite'
		];
		const shapes: TokenUsage[] = [
			{ ...EMPTY, inputTokens: 10_000, outputTokens: 2_000 }, // output-heavy, ordinary
			{ ...EMPTY, cacheWriteTokens: 10_000, inputTokens: 10_000, outputTokens: 0 }, // cache-write-heavy
			{ ...EMPTY, inputTokens: 300_000, outputTokens: 1_000 }, // long-context
			{
				...EMPTY,
				cacheReadTokens: 100_000,
				cacheWriteTokens: 100_000,
				inputTokens: 300_000,
				outputTokens: 5_000
			}, // all-of-the-above
			{ ...EMPTY, cacheWriteTokens: 300_000, inputTokens: 300_000, outputTokens: 0 } // long-context + cache-write-heavy
		];

		for (const model of models) {
			for (const shape of shapes) {
				const actual = price(model, shape);
				const ceiling = estimateCeilingNanoUsd(model, shape.inputTokens ?? 0, shape.outputTokens ?? 0);
				expect(actual).not.toBeNull();
				expect((actual?.nanoUsd ?? -1n) <= ceiling).toBe(true);
			}
		}
	});

	// WORST_CASE (used for an unrecognised model) must dominate even a cache-write-heavy call —
	// the same root cause as C2 also broke the unknown-model fallback, since it was built from
	// `max(r.input)` alone.
	test('WORST_CASE survives the invariant against a cache-write-heavy call', () => {
		const ceiling = estimateCeilingNanoUsd('definitely-not-a-model', 10_000, 0);
		const worstRealBill = price('claude-opus-4-8', { ...EMPTY, cacheWriteTokens: 10_000, inputTokens: 10_000 });
		expect((worstRealBill?.nanoUsd ?? -1n) <= ceiling).toBe(true);
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

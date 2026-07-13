import { describe, expect, test } from 'bun:test';
import { createProviderRegistry, generateText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

import { applyGuardrails, clampMaxOutputTokens, GUARDRAIL_STACK, guardrails, MAX_OUTPUT_TOKENS } from './guardrails';

/**
 * The PROVIDER-level result shape, which is NOT the `ai`-level one:
 *  - finishReason is an OBJECT `{ unified, raw }`, not the string 'stop'
 *  - usage is NESTED (`inputTokens.total`), not flat
 *  - `warnings` is required
 *  - doGenerate is passed as a VALUE: an inline `async () => ({...})` widens the
 *    literals and does not typecheck.
 */
function mockModel(): MockLanguageModelV4 {
	return new MockLanguageModelV4({
		doGenerate: {
			content: [{ text: 'ok', type: 'text' }],
			finishReason: { raw: 'stop', unified: 'stop' },
			usage: {
				inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 10, total: 10 },
				outputTokens: { reasoning: 0, text: 5, total: 5 }
			},
			warnings: []
		},
		modelId: 'mock-deployment',
		provider: 'mock'
	});
}

/**
 * A registry provider WITHOUT relying on `MockProviderV4` — that name is not in the pinned
 * v7 surface we verified, and a wrong import name is the cheapest way to fail. Derive the
 * shape from createProviderRegistry's own parameter type instead.
 */
type RegistryProvider = Parameters<typeof createProviderRegistry>[0][string];

function providerFor(model: MockLanguageModelV4): RegistryProvider {
	return { languageModel: () => model } as unknown as RegistryProvider;
}

const REJECTED_BY_AZURE = ['temperature', 'topP', 'topK', 'presencePenalty', 'frequencyPenalty', 'seed'] as const;

describe('clampMaxOutputTokens', () => {
	test('defaults when the caller omits it', () => {
		expect(clampMaxOutputTokens(undefined)).toBe(MAX_OUTPUT_TOKENS);
	});
	test('clamps a value above the ceiling', () => {
		expect(clampMaxOutputTokens(100_000)).toBe(MAX_OUTPUT_TOKENS);
	});
	test('passes through a value below the ceiling', () => {
		expect(clampMaxOutputTokens(512)).toBe(512);
	});
	test('rejects non-positive, NaN and Infinity', () => {
		expect(clampMaxOutputTokens(0)).toBe(MAX_OUTPUT_TOKENS);
		expect(clampMaxOutputTokens(-1)).toBe(MAX_OUTPUT_TOKENS);
		expect(clampMaxOutputTokens(Number.NaN)).toBe(MAX_OUTPUT_TOKENS);
		expect(clampMaxOutputTokens(Number.POSITIVE_INFINITY)).toBe(MAX_OUTPUT_TOKENS);
	});
});

describe('guardrails', () => {
	// All GPT-5.x are reasoning models: they return HTTP 400 on every one of these.
	test('params Azure rejects never reach doGenerate, and maxOutputTokens is clamped', async () => {
		const model = mockModel();

		await generateText({
			frequencyPenalty: 0.5,
			maxOutputTokens: 100_000,
			model: applyGuardrails(model),
			presencePenalty: 0.5,
			prompt: 'hi',
			seed: 42,
			temperature: 0.7,
			topK: 40,
			topP: 0.9
		});

		expect(model.doGenerateCalls.length).toBe(1);
		const call = model.doGenerateCalls[0];
		expect(call).toBeDefined();
		// noUncheckedIndexedAccess: `call` is T | undefined until asserted.
		const seen = call as unknown as Record<string, unknown>;

		// Own-property ABSENT, not merely `undefined` — the middleware deletes the keys.
		// (`{ temperature: undefined }` still serialises to `"temperature": null` on some
		// providers and still 400s.)
		for (const key of REJECTED_BY_AZURE) {
			expect(Object.hasOwn(seen, key)).toBe(false);
		}
		expect(seen.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
	});

	// Without a forced ceiling the quota reservation is meaningless: reserve 1K output tokens,
	// model returns 8K, user is billed for what was never reserved.
	test('forces maxOutputTokens even when the caller omits it', async () => {
		const model = mockModel();
		await generateText({ model: applyGuardrails(model), prompt: 'hi' });

		const seen = model.doGenerateCalls[0] as unknown as Record<string, unknown>;
		expect(seen.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
	});
});

describe('one guardrail implementation', () => {
	test('the stack is exactly the single exported guardrails object', () => {
		expect(GUARDRAIL_STACK.length).toBe(1);
		expect(GUARDRAIL_STACK[0]).toBe(guardrails);
	});

	// BYOK must not be able to skip the guardrail: both paths use GUARDRAIL_STACK.
	test('BYOK (wrapLanguageModel) and platform (registry) paths both strip and clamp', async () => {
		const byokModel = mockModel();
		await generateText({
			maxOutputTokens: 99_999,
			model: applyGuardrails(byokModel),
			prompt: 'hi',
			temperature: 0.9
		});

		// A registry built exactly the way the real one is (same options object shape).
		const platformMock = mockModel();
		const testRegistry = createProviderRegistry(
			{ mock: providerFor(platformMock) },
			{ languageModelMiddleware: GUARDRAIL_STACK }
		);
		await generateText({
			maxOutputTokens: 99_999,
			model: testRegistry.languageModel('mock:chat'),
			prompt: 'hi',
			temperature: 0.9
		});

		for (const model of [byokModel, platformMock]) {
			const seen = model.doGenerateCalls[0] as unknown as Record<string, unknown>;
			expect(Object.hasOwn(seen, 'temperature')).toBe(false);
			expect(seen.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
		}
	});
});

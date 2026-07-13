import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { generateText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

// registry.ts reads env at MODULE LOAD (createAzure). Mock '@/env' BEFORE importing it, or
// this file throws on any machine whose .env lacks AZURE_* — i.e. every CI runner.
mock.module('@/env', () => ({
	env: {
		AZURE_OPENAI_API_KEY: 'test-key',
		AZURE_OPENAI_CHAT_DEPLOYMENT: 'prod-mini-deployment',
		AZURE_OPENAI_CHAT_MODEL: 'gpt-5.4-mini',
		AZURE_OPENAI_RESOURCE_NAME: 'acme'
	}
}));

/**
 * A spy on the REAL provider factory `getPlatformRegistry` calls — NOT a hand-built registry
 * like guardrails.test.ts uses. C1's platform-path test drives `platformModel().model` through
 * the real `generateText` to prove the registry's `languageModelMiddleware` option is actually
 * wired, not just that GUARDRAIL_STACK holds the right object in isolation.
 */
const azureModelsCreated: MockLanguageModelV4[] = [];

mock.module('@ai-sdk/azure', () => ({
	createAzure: () => {
		const provider = (modelId: string) => {
			const model = new MockLanguageModelV4({
				doGenerate: {
					content: [{ text: 'ok', type: 'text' }],
					finishReason: { raw: 'stop', unified: 'stop' },
					usage: {
						inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 10, total: 10 },
						outputTokens: { reasoning: 0, text: 5, total: 5 }
					},
					warnings: []
				},
				modelId,
				provider: 'mock-azure'
			});
			azureModelsCreated.push(model);
			return model;
		};
		return Object.assign(provider, { languageModel: provider });
	}
}));

const { MAX_OUTPUT_TOKENS, platformModel } = await import('./registry');
const { price } = await import('./pricing/price');

beforeEach(() => {
	azureModelsCreated.length = 0;
});

describe('platformModel', () => {
	// The deployment name and the model are DIFFERENT strings and are used for different
	// things. Pricing on the deployment name yields UNKNOWN_MODEL and a free ride.
	test('modelId is the deployment; resolvedModel is the real model', () => {
		const resolved = platformModel();
		expect(resolved.byok).toBe(false);
		expect(resolved.providerId).toBe('azure');
		expect(resolved.modelId).toBe('prod-mini-deployment');
		expect(resolved.resolvedModel).toBe('gpt-5.4-mini');
	});

	// Cross-task guard: a platform model that price() cannot price bills nobody.
	test('the platform resolvedModel is priceable by the vendored catalogue', () => {
		const resolved = platformModel();
		expect(
			price(resolved.resolvedModel, {
				cacheReadTokens: null,
				cacheWriteTokens: null,
				inputTokens: 1000,
				outputTokens: 100
			})
		).not.toBeNull();
		// And the deployment name is NOT priceable — proving the two are not interchangeable.
		expect(
			price(resolved.modelId, {
				cacheReadTokens: null,
				cacheWriteTokens: null,
				inputTokens: 1000,
				outputTokens: 100
			})
		).toBeNull();
	});
});

// C1: the ENTIRE platform-side guardrail attachment is the `{ languageModelMiddleware:
// GUARDRAIL_STACK }` options object passed to `createProviderRegistry`. No prior test drove a
// real `generateText` call through `platformModel().model` — guardrails.test.ts's registry
// check hand-builds its OWN `createProviderRegistry`, which proves the mechanism works in the
// abstract but proves nothing about whether `registry.ts` actually wires it up. This test does.
describe('platformModel — guardrail attachment (mutation-tested)', () => {
	test('the model reaching generateText has temperature stripped and output clamped', async () => {
		const resolved = platformModel();

		await generateText({
			maxOutputTokens: 999_999,
			model: resolved.model,
			prompt: 'hi',
			temperature: 2
		});

		expect(azureModelsCreated.length).toBe(1);
		const spy = azureModelsCreated[0];
		expect(spy).toBeDefined();
		expect(spy?.doGenerateCalls.length).toBe(1);
		const seen = spy?.doGenerateCalls[0] as unknown as Record<string, unknown>;
		expect(Object.hasOwn(seen, 'temperature')).toBe(false);
		expect(seen.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
	});
});

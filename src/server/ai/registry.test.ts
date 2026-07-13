import { describe, expect, mock, test } from 'bun:test';

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

const { platformModel } = await import('./registry');
const { price } = await import('./pricing/price');

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

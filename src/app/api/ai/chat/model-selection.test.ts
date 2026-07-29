import { describe, expect, test } from 'bun:test';
import { modelSelectorSchema } from '@/server/ai/model-selector-schema';

describe('modelSelectorSchema', () => {
	test('accepts a byok selector WITHOUT a modelId (back-compat)', () => {
		const parsed = modelSelectorSchema.safeParse({ kind: 'byok', provider: 'ANTHROPIC' });
		expect(parsed.success).toBe(true);
	});

	test('accepts a byok selector WITH a modelId', () => {
		const parsed = modelSelectorSchema.safeParse({
			kind: 'byok',
			modelId: 'claude-sonnet-5',
			provider: 'ANTHROPIC'
		});
		expect(parsed.success).toBe(true);
	});

	test('accepts the platform selector', () => {
		expect(modelSelectorSchema.safeParse({ kind: 'platform' }).success).toBe(true);
	});

	test('rejects an unknown provider', () => {
		expect(modelSelectorSchema.safeParse({ kind: 'byok', provider: 'NOPE' }).success).toBe(false);
	});

	test('rejects an empty modelId', () => {
		const parsed = modelSelectorSchema.safeParse({ kind: 'byok', modelId: '', provider: 'OPENAI' });
		expect(parsed.success).toBe(false);
	});
});

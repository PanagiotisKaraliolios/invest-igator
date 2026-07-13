import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { generateText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { Secret } from '@/server/ai/crypto';
import { MAX_OUTPUT_TOKENS, markUnguarded } from '@/server/ai/guardrails';

/**
 * probe.ts's OWN `buildByokModel` wraps whatever `resolve-model.ts`'s `buildByokModel` returns
 * with `applyGuardrails(...)` (probe.ts ~line 28) — "BYOK cannot skip guardrails via the probe
 * path" is a load-bearing claim on reuse. `ai-credentials.test.ts` mocks the ENTIRE
 * `@/server/ai/probe` module, so nothing there ever drives the real `probeCredential` /
 * `buildByokModel`, and the wrap has no covering test.
 *
 * Here we mock only the underlying provider CONSTRUCTION (`resolve-model.ts`'s
 * `buildByokModel`, which would otherwise reach out to a real provider SDK / network) with an
 * injectable `MockLanguageModelV4` that records the params it receives, and let the REAL
 * `probe.ts` run end to end — hermetic, no network — mirroring the pattern `guardrails.test.ts`
 * and `registry.test.ts` use for proving a wrap is actually wired rather than merely present in
 * isolation.
 */
let mockModel: MockLanguageModelV4;

function freshMockModel(): MockLanguageModelV4 {
	return new MockLanguageModelV4({
		doGenerate: {
			content: [{ text: 'pong', type: 'text' }],
			finishReason: { raw: 'stop', unified: 'stop' },
			usage: {
				inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
				outputTokens: { reasoning: 0, text: 1, total: 1 }
			},
			warnings: []
		},
		modelId: 'mock-deployment',
		provider: 'mock'
	});
}

const actualResolveModel = await import('@/server/ai/resolve-model');
mock.module('@/server/ai/resolve-model', () => ({
	...actualResolveModel,
	// Bypasses real provider-SDK construction (which would need a real endpoint/key and a
	// network call). What's under test is what probe.ts's OWN `buildByokModel` does with
	// whatever raw model this returns — i.e. whether it wraps it in `applyGuardrails(...)`
	// before handing it to `generateText`.
	buildByokModel: () => markUnguarded(mockModel)
}));

const { buildByokModel, probeCredential } = await import('@/server/ai/probe');

const config = {
	apiVersion: null,
	baseURL: null,
	defaultModelId: 'gpt-test',
	deployment: null,
	provider: 'OPENAI',
	resourceName: null
} as const;

beforeEach(() => {
	mockModel = freshMockModel();
});

describe('probe.ts guardrail attachment — BYOK cannot skip guardrails via the probe path', () => {
	test('the probe path strips reasoning-rejected params and clamps maxOutputTokens', async () => {
		const wrapped = buildByokModel(config, new Secret('sk-test-key'));

		// Drive the wrapped model exactly like guardrails.test.ts drives applyGuardrails(...):
		// an excess temperature and an over-ceiling maxOutputTokens must both be caught here,
		// which only happens if probe.ts's `buildByokModel` actually applied the guardrail stack.
		await generateText({ maxOutputTokens: 99_999, model: wrapped, prompt: 'hi', temperature: 0.9 });

		expect(mockModel.doGenerateCalls.length).toBe(1);
		const call = mockModel.doGenerateCalls[0] as unknown as Record<string, unknown>;
		// Own-property ABSENT, not merely undefined — the middleware deletes the key.
		expect(Object.hasOwn(call, 'temperature')).toBe(false);
		expect(call.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
	});

	// End-to-end: probeCredential's internal generateText call must actually succeed through a
	// guardrail-wrapped model. If the wrap in probe.ts's buildByokModel is removed, the raw
	// `Unguarded` marker object (not a LanguageModel) is handed to `generateText` directly and
	// the call blows up instead of returning `{ ok: true }`.
	test('the real probeCredential succeeds end-to-end through the guardrail-wrapped model', async () => {
		const result = await probeCredential(config, new Secret('sk-test-key'));

		expect(result).toEqual({ ok: true });
		expect(mockModel.doGenerateCalls.length).toBe(1);
	});
});

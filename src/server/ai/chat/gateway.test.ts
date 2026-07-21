import { describe, expect, mock, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { type LanguageModelUsage, simulateReadableStream, type UIMessage } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { markUnguarded } from '@/server/ai/guardrails';
import { price } from '@/server/ai/pricing/price';
import type { Reservation } from '@/server/ai/quota';
import { applyGuardrails, type ResolvedModel } from '@/server/ai/registry';
import { toTokenUsage } from '@/server/ai/telemetry';

/**
 * Hermetic like tool-ctx.test.ts / resolve-model.test.ts: gateway.ts's `deps` seam covers
 * resolveModel/reserve/settle/loadTurnHistory/saveTurn, but `createToolCtx` is NOT part of
 * that seam (it reads `db.user.findUnique` for the user's display currency) — so `@/server/db`
 * is mocked here, and createToolCtx runs for real against the mock.
 */
mock.module('@/server/db', () => ({
	db: {
		user: {
			findUnique: async () => ({ currency: 'USD' })
		}
	}
}));

const { streamChatTurn } = await import('./gateway');

function userMsg(text: string): UIMessage {
	return { id: randomUUID(), parts: [{ text, type: 'text' }], role: 'user' };
}

/**
 * Chunk shape verified against `node_modules/@ai-sdk/provider`'s `LanguageModelV4StreamPart`
 * (the `stream-start`/`text-start`/`text-delta`/`text-end`/`finish` variants) and matched to the
 * nested `LanguageModelV4Usage` shape `probe.test.ts` and `registry.test.ts` already drive
 * through `doGenerate` — `finishReason` is the `{ raw, unified }` object form, not a bare string.
 */
function okModel(): MockLanguageModelV4 {
	return new MockLanguageModelV4({
		doStream: async () => ({
			stream: simulateReadableStream({
				chunks: [
					{ type: 'stream-start', warnings: [] },
					{ id: '1', type: 'text-start' },
					{ delta: 'Your portfolio is fine.', id: '1', type: 'text-delta' },
					{ id: '1', type: 'text-end' },
					{
						finishReason: { raw: 'stop', unified: 'stop' },
						type: 'finish',
						usage: {
							inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 10, total: 10 },
							outputTokens: { reasoning: 0, text: 5, total: 5 }
						}
					}
				]
			})
		}),
		modelId: 'mock-deployment',
		provider: 'mock'
	});
}

function resolvedPlatform(): ResolvedModel {
	return {
		byok: false,
		model: applyGuardrails(markUnguarded(okModel())),
		modelId: 'dep',
		providerId: 'azure',
		resolvedModel: 'gpt-5-mini'
	};
}

/** Like `okModel`, but paces the chunks so an abort can land mid-stream, before `finish`. */
function slowModel(): MockLanguageModelV4 {
	return new MockLanguageModelV4({
		doStream: async () => ({
			stream: simulateReadableStream({
				chunkDelayInMs: 40,
				chunks: [
					{ type: 'stream-start', warnings: [] },
					{ id: '1', type: 'text-start' },
					{ delta: 'Your portfolio', id: '1', type: 'text-delta' },
					{ delta: ' is fine.', id: '1', type: 'text-delta' },
					{ id: '1', type: 'text-end' },
					{
						finishReason: { raw: 'stop', unified: 'stop' },
						type: 'finish',
						usage: {
							inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 10, total: 10 },
							outputTokens: { reasoning: 0, text: 5, total: 5 }
						}
					}
				]
			})
		}),
		modelId: 'mock-deployment',
		provider: 'mock'
	});
}

function resolvedSlowPlatform(): ResolvedModel {
	return { ...resolvedPlatform(), model: applyGuardrails(markUnguarded(slowModel())) };
}

function resolvedByok(): ResolvedModel {
	return {
		byok: true,
		model: applyGuardrails(markUnguarded(okModel())),
		modelId: 'claude',
		providerId: 'anthropic',
		resolvedModel: 'claude-haiku-4-5'
	};
}

/**
 * The aggregate `LanguageModelUsage` streamText hands `onEnd` for `okModel`'s single finish
 * chunk (inputTokens.total 10 / outputTokens.total 5, no cache). The gateway settles
 * `price(resolvedModel, toTokenUsage(usage))?.nanoUsd`; the test recomputes the SAME amount so
 * the "reserves then settles" case can assert the money, not just the call count.
 */
const FINISH_USAGE: LanguageModelUsage = {
	inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 0, noCacheTokens: 10 },
	inputTokens: 10,
	outputTokenDetails: { reasoningTokens: 0, textTokens: 5 },
	outputTokens: 5,
	totalTokens: 15
};

describe('streamChatTurn', () => {
	test('platform turn reserves then settles with the priced actual', async () => {
		const reserve = mock(async (): Promise<Reservation> => ({ ceilingNanoUsd: 1000n, id: 'res-1', userId: 'u1' }));
		const settle = mock(async () => {});

		const res = await streamChatTurn(
			{ chatId: 'c1', incoming: userMsg('hi'), selector: { kind: 'platform' }, session: { user: { id: 'u1' } } },
			{
				loadTurnHistory: async () => [],
				reserve,
				resolveModel: async () => resolvedPlatform(),
				saveTurn: async () => {},
				settle
			}
		);
		await res.text(); // drain the stream so onEnd fires

		expect(reserve).toHaveBeenCalledTimes(1);
		expect(settle).toHaveBeenCalledTimes(1);

		// Money invariant: the settled actual must be priced on `resolvedModel` ('gpt-5-mini'),
		// NOT `modelId` ('dep', absent from the catalogue). A regression to modelId prices null →
		// settle(null) → still one call, but the amount would be null, not this positive bigint.
		const expected = price('gpt-5-mini', toTokenUsage(FINISH_USAGE))?.nanoUsd;
		expect(expected).toBeGreaterThan(0n);
		expect(settle.mock.calls[0]?.[1]).toBe(expected);
	});

	test('byok turn does not reserve or settle', async () => {
		const reserve = mock(async (): Promise<Reservation> => ({ ceilingNanoUsd: 0n, id: 'x', userId: 'u1' }));
		const settle = mock(async () => {});

		const res = await streamChatTurn(
			{
				chatId: 'c1',
				incoming: userMsg('hi'),
				selector: { kind: 'byok', provider: 'ANTHROPIC' },
				session: { user: { id: 'u1' } }
			},
			{
				loadTurnHistory: async () => [],
				reserve,
				resolveModel: async () => resolvedByok(),
				saveTurn: async () => {},
				settle
			}
		);
		await res.text();

		expect(reserve).not.toHaveBeenCalled();
		expect(settle).not.toHaveBeenCalled();
	});

	test('persists the turn on finish', async () => {
		const saveTurn = mock(async () => {});

		const res = await streamChatTurn(
			{ chatId: 'c1', incoming: userMsg('hi'), selector: { kind: 'platform' }, session: { user: { id: 'u1' } } },
			{
				loadTurnHistory: async () => [],
				reserve: async () => ({ ceilingNanoUsd: 1n, id: 'r', userId: 'u1' }),
				resolveModel: async () => resolvedPlatform(),
				saveTurn,
				settle: async () => {}
			}
		);
		await res.text();

		expect(saveTurn).toHaveBeenCalledTimes(1);
	});

	// The MOST common non-success path: the user hits "stop". The reservation must be settled
	// (releasing its held ceiling now) rather than left for the 10-minute orphan sweeper — and
	// settled EXACTLY ONCE, never alongside a success settle.
	test('aborted turn settles exactly once (partial spend), not left for the sweeper', async () => {
		const settle = mock(async () => {});
		const controller = new AbortController();

		const res = await streamChatTurn(
			{
				abortSignal: controller.signal,
				chatId: 'c1',
				incoming: userMsg('hi'),
				selector: { kind: 'platform' },
				session: { user: { id: 'u1' } }
			},
			{
				loadTurnHistory: async () => [],
				reserve: async (): Promise<Reservation> => ({ ceilingNanoUsd: 1000n, id: 'res-1', userId: 'u1' }),
				resolveModel: async () => resolvedSlowPlatform(),
				saveTurn: async () => {},
				settle
			}
		);
		controller.abort();
		await res.text(); // drain so the terminal onAbort callback fires

		expect(settle).toHaveBeenCalledTimes(1);
		// Aborting at t≈0 (chunks are paced 40ms apart) lands before the single step's `finish`,
		// so `onAbort`'s `steps` is empty → the priced partial is exactly 0n. That value proves it
		// was the ABORT path specifically: `onEnd` would settle the full priced amount (> 0), and
		// `onError` would settle `null` (the full-ceiling fail-safe). 0n is none of those by accident.
		expect(settle.mock.calls[0]?.[1]).toBe(0n);
	});

	test('a setup failure after reserve settles the reservation (null → ceiling), not leaking to the sweeper', async () => {
		const reserve = mock(async (): Promise<Reservation> => ({ ceilingNanoUsd: 1000n, id: 'res-1', userId: 'u1' }));
		const settle = mock(async () => {});
		// A prior message with an unsupported role makes `convertToModelMessages` throw — after
		// `reserve`, but before streamText's terminal callbacks exist. The gateway's catch settles it.
		const badHistory = [
			{ id: 'bad', parts: [{ text: 'x', type: 'text' }], role: 'banana' }
		] as unknown as UIMessage[];
		await expect(
			streamChatTurn(
				{
					chatId: 'c1',
					incoming: userMsg('hi'),
					selector: { kind: 'platform' },
					session: { user: { id: 'u1' } }
				},
				{
					loadTurnHistory: async () => badHistory,
					reserve,
					resolveModel: async () => resolvedPlatform(),
					saveTurn: async () => {},
					settle
				}
			)
		).rejects.toThrow();
		expect(settle).toHaveBeenCalledTimes(1);
		expect(settle.mock.calls[0]?.[1]).toBeNull();
	});
});

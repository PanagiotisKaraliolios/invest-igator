import { describe, expect, mock, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { simulateReadableStream, type UIMessage } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { markUnguarded } from '@/server/ai/guardrails';
import type { Reservation } from '@/server/ai/quota';
import { applyGuardrails, type ResolvedModel } from '@/server/ai/registry';

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

function resolvedByok(): ResolvedModel {
	return {
		byok: true,
		model: applyGuardrails(markUnguarded(okModel())),
		modelId: 'claude',
		providerId: 'anthropic',
		resolvedModel: 'claude-haiku-4-5'
	};
}

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
});

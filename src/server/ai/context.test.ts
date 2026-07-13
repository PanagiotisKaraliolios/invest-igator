import { describe, expect, test } from 'bun:test';
import { type AiCallContext, aiContext, runWithAiContext } from './context';

const ctx = (over: Partial<AiCallContext> = {}): AiCallContext => ({
	byok: false,
	functionId: 'chat.turn',
	requestId: 'req-1',
	resolvedModel: 'gpt-5.4-mini',
	surface: 'CHAT',
	userId: 'user-1',
	...over
});

describe('aiContext', () => {
	test('there is no store outside runWithAiContext', () => {
		expect(aiContext.getStore()).toBeUndefined();
	});

	test('runWithAiContext exposes the context to the callee', async () => {
		const seen = await runWithAiContext(ctx(), async () => aiContext.getStore());
		expect(seen?.requestId).toBe('req-1');
		expect(seen?.userId).toBe('user-1');
		expect(seen?.resolvedModel).toBe('gpt-5.4-mini');
	});

	test('the context survives an await boundary and a nested async callback', async () => {
		const seen = await runWithAiContext(ctx({ requestId: 'req-2' }), async () => {
			await new Promise((r) => setTimeout(r, 1));
			return Promise.resolve().then(() => aiContext.getStore()?.requestId);
		});
		expect(seen).toBe('req-2');
	});

	test('concurrent contexts do not bleed into each other', async () => {
		const run = async (id: string) =>
			runWithAiContext(ctx({ requestId: id, userId: id }), async () => {
				await new Promise((r) => setTimeout(r, Math.random() * 5));
				return aiContext.getStore()?.userId;
			});
		const results = await Promise.all([run('a'), run('b'), run('c')]);
		expect(results).toEqual(['a', 'b', 'c']);
	});

	test('the store is cleared after the callback resolves', async () => {
		await runWithAiContext(ctx(), async () => undefined);
		expect(aiContext.getStore()).toBeUndefined();
	});

	test('the store is cleared after the callback REJECTS', async () => {
		await expect(
			runWithAiContext(ctx(), async () => {
				throw new Error('boom');
			})
		).rejects.toThrow('boom');
		expect(aiContext.getStore()).toBeUndefined();
	});
});

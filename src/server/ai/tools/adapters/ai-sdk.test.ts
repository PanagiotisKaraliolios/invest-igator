import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import type { Currency } from '@/lib/currency';
import type { AppTool, Scope, ToolCtx } from '../types';
import { fromAiSdkToolName, toAiSdkToolName, toAiSdkTools } from './ai-sdk';

const ctx: ToolCtx = {
	currency: 'USD' as Currency,
	scopes: new Set<Scope>(['portfolio:read']),
	surface: 'chat',
	userId: 'user-b'
};

const echoTool: AppTool = {
	annotations: { openWorldHint: false, readOnlyHint: true, title: 'Portfolio structure' },
	description: 'the structure tool',
	execute: async (_input, c) => ({ aborted: c.abortSignal?.aborted ?? null, userId: c.userId }),
	inputSchema: z.strictObject({}),
	mutates: false,
	name: 'portfolio.structure',
	outputSchema: z.strictObject({ aborted: z.boolean().nullable(), userId: z.string() }),
	requiredScope: 'portfolio:read'
};

const historyTool: AppTool = {
	annotations: { openWorldHint: false, readOnlyHint: true, title: 'Price history' },
	description: 'the price-history tool',
	execute: async () => ({ ok: true }),
	inputSchema: z.strictObject({ symbol: z.string() }),
	mutates: false,
	name: 'market.priceHistory',
	outputSchema: z.strictObject({ ok: z.boolean() }),
	requiredScope: 'watchlist:read'
};

describe('the AI SDK tool-name mapping', () => {
	test('dots are illegal in AI SDK tool names — they become underscores', () => {
		expect(toAiSdkToolName('portfolio.structure')).toBe('portfolio_structure');
		expect(toAiSdkToolName('market.priceHistory')).toBe('market_priceHistory');
	});

	test('the mapping round-trips', () => {
		for (const name of ['portfolio.structure', 'market.priceHistory', 'fx.rates']) {
			expect(fromAiSdkToolName(toAiSdkToolName(name))).toBe(name);
		}
	});

	test('a name that would not survive the mapping is rejected at build time, not silently shipped', () => {
		const bad: AppTool = { ...echoTool, name: 'portfolio structure!' };
		expect(() => toAiSdkTools([bad], ctx)).toThrow(/illegal ai sdk tool name/i);
	});
});

describe('toAiSdkTools', () => {
	test('keys the ToolSet by the mapped name and carries description + schemas across', () => {
		const set = toAiSdkTools([echoTool, historyTool], ctx);
		expect(Object.keys(set).sort()).toEqual(['market_priceHistory', 'portfolio_structure']);

		const mapped = set.portfolio_structure;
		expect(mapped).toBeDefined();
		expect(mapped?.description).toBe('the structure tool');
		expect(mapped?.inputSchema).toBe(echoTool.inputSchema);
		expect(mapped?.outputSchema).toBe(echoTool.outputSchema);
	});

	test('the bound ctx — not the model input — supplies the userId at execute time', async () => {
		const set = toAiSdkTools([echoTool], ctx);
		const execute = set.portfolio_structure?.execute;
		expect(execute).toBeDefined();
		const out = await execute?.({}, { messages: [], toolCallId: 'call-1' });
		expect(out).toEqual({ aborted: null, userId: 'user-b' });
	});

	test("the SDK's abortSignal is threaded into ToolCtx, so a cancelled request cancels the tool", async () => {
		const controller = new AbortController();
		controller.abort();
		const set = toAiSdkTools([echoTool], ctx);
		const out = await set.portfolio_structure?.execute?.(
			{},
			{ abortSignal: controller.signal, messages: [], toolCallId: 'call-2' }
		);
		expect(out).toEqual({ aborted: true, userId: 'user-b' });
	});
});

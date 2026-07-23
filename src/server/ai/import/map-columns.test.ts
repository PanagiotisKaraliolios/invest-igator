import { describe, expect, test } from 'bun:test';
import type { LanguageModelV4FinishReason, LanguageModelV4Usage } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';
import { mapColumns } from './map-columns';

/**
 * The PROVIDER-SPEC usage/finishReason shapes `doGenerate` RETURNS (`LanguageModelV4Usage` /
 * `LanguageModelV4FinishReason`) — nested token counts, no flat `totalTokens`, and
 * `finishReason` is `{ raw, unified }`, not a bare string. Mirrors
 * `src/server/ai/evals/support.ts` / `advice-judge.test.ts`, the repo's existing
 * `generateObject`-via-`MockLanguageModelV4` precedent — see task report for why this differs
 * from the brief's `finishReason: 'stop'` / flat `usage` sketch.
 */
const MOCK_USAGE: LanguageModelV4Usage = {
	inputTokens: { cacheRead: undefined, cacheWrite: undefined, noCache: 11, total: 11 },
	outputTokens: { reasoning: undefined, text: 7, total: 7 }
};

const MOCK_FINISH: LanguageModelV4FinishReason = { raw: 'stop', unified: 'stop' };

// generateObject reads the model's JSON text from `content`. Return a valid ColumnMapping.
function modelReturning(obj: unknown): MockLanguageModelV4 {
	return new MockLanguageModelV4({
		doGenerate: async () => ({
			content: [{ text: JSON.stringify(obj), type: 'text' as const }],
			finishReason: MOCK_FINISH,
			usage: MOCK_USAGE,
			warnings: []
		})
	});
}

describe('mapColumns', () => {
	test('returns the parsed mapping the model produced', async () => {
		const model = modelReturning({
			date: 0,
			dateFormat: 'MDY_SLASH',
			fee: null,
			feeCurrency: null,
			note: null,
			price: 4,
			priceCurrency: null,
			quantity: 3,
			side: 2,
			sideMap: [{ from: 'B', to: 'BUY' }],
			symbol: 1
		});
		const mapping = await mapColumns(
			model,
			['Trade Date', 'Ticker', 'Action', 'Qty', 'Price'],
			[['01/15/2026', 'AAPL', 'B', '10', '150.5']]
		);
		expect(mapping.symbol).toBe(1);
		expect(mapping.dateFormat).toBe('MDY_SLASH');
		expect(mapping.sideMap).toEqual([{ from: 'B', to: 'BUY' }]);
	});
});

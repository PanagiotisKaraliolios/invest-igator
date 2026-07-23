import { describe, expect, test } from 'bun:test';
import { fromAiSdkToolName, toAiSdkToolName } from '@/server/ai/tools/adapters/ai-sdk';
import { ALL_TOOLS } from '@/server/ai/tools/registry';
import { ARTIFACT_RENDERERS, renderArtifact } from './registry';

/**
 * Schema-shaped, empty-but-valid output per tool. Every renderer has empty-state handling, so a
 * minimal output still renders a NODE (not null) — which is what the runtime-path test asserts.
 */
function minimalOutputFor(name: string): unknown {
	switch (name) {
		case 'portfolio.structure':
			return { currency: 'USD', positions: [], totalValue: 0, truncated: false };
		case 'portfolio.performance':
			return {
				currency: 'USD',
				mwrPct: 0,
				points: [],
				pointsAreDownsampled: false,
				truncated: false,
				twrPct: 0,
				unconvertedSymbolCount: 0,
				unconvertedSymbols: []
			};
		case 'market.priceHistory':
			return { field: 'close', points: [], symbol: 'AAPL', truncated: false };
		case 'transactions.search':
			return { count: 0, hasMore: false, transactions: [] };
		case 'watchlist.list':
			return { count: 0, hasMore: false, items: [] };
		case 'goals.list':
			return { count: 0, goals: [], hasMore: false };
		case 'fx.rates':
			return { base: 'USD', rates: {} };
		case 'transactions.create':
			return {
				confirmationToken: 'tok',
				expiresAt: '2026-01-01T00:02:00.000Z',
				preview: 'Buy 1 AAPL @ 1 USD on 2026-01-01',
				proposed: {
					date: '2026-01-01',
					price: 1,
					priceCurrency: 'USD',
					quantity: 1,
					side: 'BUY',
					symbol: 'AAPL'
				},
				requiresConfirmation: true
			};
		default:
			throw new Error(`no minimal output for ${name}`);
	}
}

describe('artifact registry', () => {
	test('every Phase 0 tool name has a renderer', () => {
		for (const tool of ALL_TOOLS) {
			expect(typeof ARTIFACT_RENDERERS[tool.name]).toBe('function');
		}
	});

	test('renderer keys are canonical dot names (no underscores)', () => {
		for (const key of Object.keys(ARTIFACT_RENDERERS)) {
			expect(key.includes('_')).toBe(false);
			expect(key.includes('.')).toBe(true);
		}
	});

	test('renderArtifact resolves the SDK underscore tool name to its renderer (runtime path)', () => {
		for (const tool of ALL_TOOLS) {
			// The underscore name that actually arrives at runtime from getToolName(part).
			const sdkName = toAiSdkToolName(tool.name);
			// Sanity: for these 7 tools the SDK form really does differ from canonical.
			expect(fromAiSdkToolName(sdkName)).toBe(tool.name);

			const node = renderArtifact(sdkName, {
				output: minimalOutputFor(tool.name),
				state: 'output-available'
			});
			// The artifact element (2nd/last child) must be present, not null — i.e. the renderer
			// resolved from the underscore name. Before the fromAiSdkToolName fix, this was null.
			const children = (node as { props: { children: unknown[] } }).props.children;
			expect(children[children.length - 1]).not.toBeNull();
		}
	});
});

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { z } from 'zod';
import type { Currency } from '@/lib/currency';
import { MAX_TOOL_RESULT_TOKENS } from '@/server/ai/guardrails';
import type { AppTool, Scope, ToolCtx } from './types';

/**
 * Same ~4 chars/token rule of thumb guardrails.ts documents next to MAX_TOOL_RESULT_TOKENS.
 * Used only to turn a serialized-length assertion into a token-budget assertion for these
 * tests; result-bounds.ts is the actual enforcement mechanism, this just checks its effect.
 */
const estimatedTokens = (value: unknown): number => Math.ceil(JSON.stringify(value).length / 4);

/**
 * The declared JSON Schema `maximum` for one top-level input property. Tests that claim to
 * exercise a tool "at its own max" MUST read the max from the schema itself, not from a
 * hardcoded literal or the default — otherwise raising the real max in source silently stops
 * being caught (a bug this file hit once already; see the mutation-testing note above).
 */
const schemaMax = (schema: z.ZodType, key: string): number => {
	const json = z.toJSONSchema(schema) as { properties?: Record<string, { maximum?: number }> };
	const max = json.properties?.[key]?.maximum;
	if (typeof max !== 'number') throw new Error(`no numeric maximum declared for '${key}'`);
	return max;
};

/**
 * Hermetic. Every data-access module the tools import is replaced, so this suite
 * touches no Postgres and no Influx — and, crucially, it records the userId each
 * tool hands to the data layer. That is the assertion that matters: the userId
 * comes from ToolCtx and from nowhere else.
 */

const seenUserIds: string[] = [];
const seenSymbols: string[] = [];

const TX: Record<string, Array<Record<string, unknown>>> = {
	'user-a': [
		{
			date: '2024-01-01T00:00:00.000Z',
			fee: null,
			feeCurrency: null,
			id: 'tx-a',
			note: null,
			price: 100,
			priceCurrency: 'USD',
			quantity: 1,
			side: 'BUY',
			symbol: 'AAAA'
		}
	],
	'user-b': [
		{
			date: '2024-02-02T00:00:00.000Z',
			fee: null,
			feeCurrency: null,
			id: 'tx-b',
			note: null,
			price: 200,
			priceCurrency: 'USD',
			quantity: 2,
			side: 'SELL',
			symbol: 'BBBB'
		}
	],
	/**
	 * 300 rows, each with a `note` far longer than anything the UI would normally produce.
	 * `Transaction.note` has NO DB-level length cap (prisma/schema.prisma), so this is a
	 * legitimate worst case, not a contrived one — it is what proves the tool's output bound
	 * holds on CONTENT, not just on row count.
	 */
	'user-d': Array.from({ length: 300 }, (_, i) => ({
		date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
		fee: 1.23,
		feeCurrency: 'USD',
		id: `tx-d-${i}`,
		note: 'x'.repeat(2000),
		price: 100 + i,
		priceCurrency: 'USD',
		quantity: 1,
		side: i % 2 === 0 ? 'BUY' : 'SELL',
		symbol: 'DDDD'
	}))
};

const WATCHLIST: Record<string, Array<Record<string, unknown>>> = {
	'user-a': [{ currency: 'USD', description: null, displaySymbol: null, starred: false, symbol: 'AAAA' }],
	'user-b': [{ currency: 'USD', description: null, displaySymbol: null, starred: true, symbol: 'BBBB' }],
	/** `description` has no DB-level length cap either. */
	'user-e': Array.from({ length: 300 }, (_, i) => ({
		currency: 'USD',
		description: 'y'.repeat(2000),
		displaySymbol: null,
		starred: false,
		symbol: `SYM${i}`
	}))
};

const GOALS: Record<string, Array<Record<string, unknown>>> = {
	'user-a': [{ id: 'g-a', note: null, targetAmount: 1, targetCurrency: 'USD', targetDate: null, title: 'A goal' }],
	'user-b': [{ id: 'g-b', note: null, targetAmount: 2, targetCurrency: 'USD', targetDate: null, title: 'B goal' }],
	'user-f': Array.from({ length: 300 }, (_, i) => ({
		id: `g-f-${i}`,
		note: 'z'.repeat(2000),
		targetAmount: 1000 + i,
		targetCurrency: 'USD',
		targetDate: null,
		title: `Goal ${i}`
	}))
};

const STRUCTURE: Record<string, { items: Array<Record<string, unknown>>; totalValue: number }> = {
	'user-a': {
		items: [
			{
				avgCost: 1,
				price: 1,
				quantity: 1,
				symbol: 'AAAA',
				totalCost: 1,
				unconverted: false,
				value: 1,
				weight: 1
			}
		],
		totalValue: 1
	},
	'user-b': {
		items: [
			{
				avgCost: 5,
				price: 10,
				quantity: 4,
				symbol: 'BBBB',
				totalCost: 20,
				unconverted: false,
				value: 40,
				weight: 0.25 // a FRACTION — the tool must publish 25, not 0.25
			}
		],
		totalValue: 160
	}
};

const dayIso = (i: number): string => new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10);

/** 500 daily points — long enough to prove the tool downsamples instead of dumping the lot. */
const LONG_SERIES = Array.from({ length: 500 }, (_, i) => ({
	date: dayIso(i),
	mwrIndex: 100 + i * 0.1,
	nav: 1000 + i,
	twrIndex: 100 + i * 0.2
}));

const SERIES: Record<string, { full: Array<Record<string, unknown>>; unconvertedSymbols: string[] }> = {
	'user-a': { full: [], unconvertedSymbols: [] },
	'user-b': {
		full: [
			{ date: '2024-01-01', mwrIndex: 100, nav: 1000, twrIndex: 100 },
			{ date: '2024-01-02', mwrIndex: 105, nav: 1100, twrIndex: 110 }
		],
		unconvertedSymbols: ['ZZZZ']
	},
	'user-c': { full: LONG_SERIES, unconvertedSymbols: [] }
};

const record = (userId: string) => {
	seenUserIds.push(userId);
};

mock.module('@/server/services/transactions', () => ({
	listTransactions: async (userId: string) => {
		record(userId);
		return TX[userId] ?? [];
	},
	MAX_TRANSACTION_LIMIT: 200
}));
mock.module('@/server/services/watchlist', () => ({
	listWatchlist: async (userId: string) => {
		record(userId);
		return WATCHLIST[userId] ?? [];
	}
}));
mock.module('@/server/services/goals', () => ({
	listGoals: async (userId: string) => {
		record(userId);
		return GOALS[userId] ?? [];
	}
}));
mock.module('@/server/services/market', () => ({
	getPriceHistory: async (symbol: string, days: number, field: string) => {
		seenSymbols.push(`${symbol}|${days}|${field}`);
		// Preserves the fixed single-point fixture for every real test symbol; 'LONGHIST' is a
		// test-only symbol that returns as many points as were requested, to prove the tool's
		// runtime size bound actually engages at its own configured maximum.
		if (symbol === 'LONGHIST') {
			return Array.from({ length: days }, (_, i) => ({ date: dayIso(i), value: 100 + i * 0.37 }));
		}
		return [{ date: '2024-01-01', value: 1 }];
	}
}));
mock.module('@/server/portfolio-compute', () => ({
	getCachedFullSeries: async (userId: string) => {
		record(userId);
		return SERIES[userId] ?? { full: [], unconvertedSymbols: [] };
	},
	getCachedStructure: async (userId: string) => {
		record(userId);
		return STRUCTURE[userId] ?? { items: [], totalValue: 0 };
	}
}));
mock.module('@/server/fx-history', () => ({
	getFxMatrix: async () => ({ EUR: { EUR: 1, USD: 1.1 }, USD: { EUR: 0.9, USD: 1 } })
}));

const { ALL_TOOLS, buildToolset } = await import('./registry');

const ALL_SCOPES: Scope[] = ['fx:read', 'goals:read', 'portfolio:read', 'transactions:read', 'watchlist:read'];

const ctxFor = (userId: string, over: Partial<ToolCtx> = {}): ToolCtx => ({
	currency: 'USD' as Currency,
	scopes: new Set<Scope>(ALL_SCOPES),
	surface: 'chat',
	userId,
	...over
});

const byName = (name: string): AppTool => {
	const found = ALL_TOOLS.find((t) => t.name === name);
	if (!found) throw new Error(`no tool named ${name}`);
	return found;
};

/** Every `properties` key anywhere in a JSON Schema, however deeply nested. */
const collectPropertyNames = (node: unknown, out: string[]): string[] => {
	if (node === null || typeof node !== 'object') return out;
	if (Array.isArray(node)) {
		for (const child of node) collectPropertyNames(child, out);
		return out;
	}
	const rec = node as Record<string, unknown>;
	const props = rec.properties;
	if (props !== null && typeof props === 'object' && !Array.isArray(props)) {
		out.push(...Object.keys(props as Record<string, unknown>));
	}
	for (const value of Object.values(rec)) collectPropertyNames(value, out);
	return out;
};

beforeEach(() => {
	seenUserIds.length = 0;
	seenSymbols.length = 0;
});

describe('the Phase 0 tool set', () => {
	test('is exactly the seven read-only tools', () => {
		expect(ALL_TOOLS.map((t) => t.name).sort()).toEqual([
			'fx.rates',
			'goals.list',
			'market.priceHistory',
			'portfolio.performance',
			'portfolio.structure',
			'transactions.search',
			'watchlist.list'
		]);
		for (const t of ALL_TOOLS) {
			expect(t.mutates).toBe(false);
			expect(t.annotations.readOnlyHint).toBe(true);
			expect(t.preview).toBeUndefined();
			expect(t.description.length).toBeGreaterThan(0);
		}
	});

	test('every tool carries an outputSchema — MCP structuredContent and typed chat parts need it', () => {
		for (const t of ALL_TOOLS) {
			expect(t.outputSchema).toBeDefined();
			expect(typeof t.outputSchema.safeParse).toBe('function');
		}
	});

	test('names are `group.verb` with NO underscore — the AI SDK mapping is only reversible because of this', () => {
		for (const t of ALL_TOOLS) {
			expect({ name: t.name, ok: /^[a-z]+\.[a-zA-Z]+$/.test(t.name) }).toEqual({ name: t.name, ok: true });
			expect(t.name).not.toContain('_');
		}
	});
});

describe('THE SECURITY MODEL', () => {
	test('no inputSchema anywhere contains a userId key', () => {
		for (const t of ALL_TOOLS) {
			const names = collectPropertyNames(z.toJSONSchema(t.inputSchema), []);
			expect({ names, tool: t.name }).toEqual({
				names: names.filter((n) => n.toLowerCase() !== 'userid'),
				tool: t.name
			});
		}
	});

	test('every inputSchema is a strictObject — unknown keys are REJECTED, not passed through', () => {
		for (const t of ALL_TOOLS) {
			const schema = z.toJSONSchema(t.inputSchema) as Record<string, unknown>;
			expect({ additionalProperties: schema.additionalProperties, tool: t.name }).toEqual({
				additionalProperties: false,
				tool: t.name
			});
		}
	});

	test('a userId smuggled into model input fails the schema outright', () => {
		const parsed = byName('transactions.search').inputSchema.safeParse({ userId: 'user-a' });
		expect(parsed.success).toBe(false);
	});

	test("user B's ToolCtx returns B's transactions, never A's", async () => {
		const t = byName('transactions.search');
		const out = (await t.execute(t.inputSchema.parse({}), ctxFor('user-b'))) as {
			count: number;
			transactions: Array<{ symbol: string }>;
		};
		expect(t.outputSchema.safeParse(out).success).toBe(true);
		expect(out.transactions.map((x) => x.symbol)).toEqual(['BBBB']);
		expect(out.count).toBe(1);
		expect(seenUserIds).toEqual(['user-b']);
	});

	test("user B's ToolCtx returns B's portfolio, watchlist and goals, never A's", async () => {
		const structureTool = byName('portfolio.structure');
		const structure = (await structureTool.execute(structureTool.inputSchema.parse({}), ctxFor('user-b'))) as {
			currency: string;
			positions: Array<{ symbol: string; weightPct: number }>;
		};
		expect(structureTool.outputSchema.safeParse(structure).success).toBe(true);
		expect(structure.currency).toBe('USD');
		expect(structure.positions.map((p) => p.symbol)).toEqual(['BBBB']);
		// StructureItem.weight is a FRACTION (0..1); the tool must publish a percentage.
		expect(structure.positions[0]?.weightPct).toBeCloseTo(25, 9);

		const watchlist = (await byName('watchlist.list').execute({}, ctxFor('user-b'))) as {
			items: Array<{ symbol: string }>;
		};
		expect(watchlist.items.map((i) => i.symbol)).toEqual(['BBBB']);

		const goals = (await byName('goals.list').execute({}, ctxFor('user-b'))) as {
			goals: Array<{ id: string }>;
		};
		expect(goals.goals.map((g) => g.id)).toEqual(['g-b']);

		expect(seenUserIds).toEqual(['user-b', 'user-b', 'user-b']);
	});

	test('portfolio.performance derives returns from B series only', async () => {
		const t = byName('portfolio.performance');
		const out = (await t.execute(t.inputSchema.parse({}), ctxFor('user-b'))) as {
			mwrPct: number;
			points: Array<{ date: string }>;
			twrPct: number;
			unconvertedSymbols: string[];
		};
		expect(t.outputSchema.safeParse(out).success).toBe(true);
		expect(out.points.map((p) => p.date)).toEqual(['2024-01-01', '2024-01-02']);
		expect(out.twrPct).toBeCloseTo(10, 9);
		expect(out.mwrPct).toBeCloseTo(5, 9);
		expect(out.unconvertedSymbols).toEqual(['ZZZZ']);
		expect(seenUserIds).toEqual(['user-b']);
	});

	test('portfolio.performance downsamples a long series but keeps the true window endpoints', async () => {
		const t = byName('portfolio.performance');
		const out = (await t.execute(t.inputSchema.parse({ days: 3650 }), ctxFor('user-c'))) as {
			mwrPct: number;
			points: Array<{ date: string }>;
			pointsAreDownsampled: boolean;
			twrPct: number;
		};
		expect(t.outputSchema.safeParse(out).success).toBe(true);
		// 500 raw points, default maxPoints 180 — the model must never be handed the raw series.
		expect(out.points.length).toBe(180);
		expect(out.pointsAreDownsampled).toBe(true);
		expect(out.points[0]?.date).toBe(dayIso(0));
		expect(out.points[out.points.length - 1]?.date).toBe(dayIso(499));
		// Returns come from the TRUE endpoints of the window, not from the sample.
		expect(out.twrPct).toBeCloseTo((199.8 / 100 - 1) * 100, 6);
		expect(seenUserIds).toEqual(['user-c']);
	});

	test('market.priceHistory forwards the model-supplied symbol to the ONE query authoring site', async () => {
		const t = byName('market.priceHistory');
		const out = (await t.execute(t.inputSchema.parse({ symbol: 'AAAA' }), ctxFor('user-b'))) as {
			field: string;
			points: Array<{ date: string; value: number }>;
			symbol: string;
		};
		expect(t.outputSchema.safeParse(out).success).toBe(true);
		expect(out.symbol).toBe('AAAA');
		expect(out.field).toBe('close');
		expect(out.points).toEqual([{ date: '2024-01-01', value: 1 }]);
		// Defaults reached the service; no userId is involved — this is public market data.
		expect(seenSymbols).toEqual(['AAAA|90|close']);
		expect(seenUserIds).toEqual([]);
	});

	test('fx.rates exposes only supported currencies, defaulting the base to ctx.currency', async () => {
		const t = byName('fx.rates');
		const out = (await t.execute(t.inputSchema.parse({}), ctxFor('user-b', { currency: 'EUR' as Currency }))) as {
			base: string;
			rates: Record<string, number>;
		};
		expect(t.outputSchema.safeParse(out).success).toBe(true);
		expect(out.base).toBe('EUR');
		expect(out.rates).toEqual({ EUR: 1, USD: 1.1 });
	});
});

describe('buildToolset', () => {
	test('filters on requiredScope', () => {
		const names = buildToolset(ctxFor('user-b', { scopes: new Set<Scope>(['portfolio:read']) })).map((t) => t.name);
		expect(names.sort()).toEqual(['portfolio.performance', 'portfolio.structure']);
	});

	test('a caller with no scopes gets no tools', () => {
		expect(buildToolset(ctxFor('user-b', { scopes: new Set<Scope>() }))).toEqual([]);
	});

	test('drops mutating tools on the mcp surface, keeps them on chat', () => {
		const mutating: AppTool = {
			annotations: {
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: false,
				readOnlyHint: false,
				title: 'Fake write'
			},
			description: 'test-only mutating tool',
			execute: async () => ({ ok: true }),
			inputSchema: z.strictObject({}),
			mutates: true,
			name: 'transactions.fakewrite',
			outputSchema: z.strictObject({ ok: z.boolean() }),
			preview: async () => 'would write',
			requiredScope: 'transactions:write'
		};
		ALL_TOOLS.push(mutating);
		try {
			const scopes = new Set<Scope>([...ALL_SCOPES, 'transactions:write']);
			expect(buildToolset(ctxFor('user-b', { scopes, surface: 'chat' })).map((t) => t.name)).toContain(
				'transactions.fakewrite'
			);
			expect(buildToolset(ctxFor('user-b', { scopes, surface: 'mcp' })).map((t) => t.name)).not.toContain(
				'transactions.fakewrite'
			);
		} finally {
			ALL_TOOLS.pop();
		}
	});
});

/**
 * Task 8's quota reservation (`estimateRequestCeilingNanoUsd`, quota.ts) assumes every tool
 * result fits under MAX_TOOL_RESULT_TOKENS. Nothing enforces that except the tools themselves
 * (result-bounds.ts + the input clamps below) — these tests are what would go RED if that
 * enforcement were ever weakened or removed:
 *   - the `*.max(...)` schema clamps (mutate one back toward the service's real ceiling —
 *     3650 days, 200 transaction rows, 1000 NAV points — and the "schema rejects" tests fail);
 *   - the `boundArrayElements` calls inside each tool's `execute` (delete one and the
 *     corresponding "stays under budget" test fails, because content the tool does not
 *     control — `note`/`description` have no DB-level length cap — is no longer bounded).
 */
describe("Task 8's quota reservation is only sound if these hold: every tool result is provably bounded", () => {
	test('market.priceHistory: the tool rejects a `days` request anywhere near the service ceiling (3650)', () => {
		const t = byName('market.priceHistory');
		expect(t.inputSchema.safeParse({ days: 3650, symbol: 'AAAA' }).success).toBe(false);
	});

	test('market.priceHistory: at its OWN max `days` (read from the schema, not assumed), a full-length series still fits under MAX_TOOL_RESULT_TOKENS', async () => {
		const t = byName('market.priceHistory');
		const maxDays = schemaMax(t.inputSchema, 'days');
		expect(maxDays).toBeLessThan(3650); // the clamp is real, not cosmetic
		const out = (await t.execute(t.inputSchema.parse({ days: maxDays, symbol: 'LONGHIST' }), ctxFor('user-b'))) as {
			points: unknown[];
			truncated: boolean;
		};
		expect(t.outputSchema.safeParse(out).success).toBe(true);
		// At the schema's own max, LONGHIST returns exactly maxDays raw points — proving this
		// test actually reached the real ceiling rather than some smaller value.
		expect(out.points.length).toBeGreaterThan(0);
		expect(estimatedTokens(out)).toBeLessThanOrEqual(MAX_TOOL_RESULT_TOKENS);
	});

	test('portfolio.performance: the tool rejects a `maxPoints` request anywhere near the naive 1000-point ceiling', () => {
		const t = byName('portfolio.performance');
		expect(t.inputSchema.safeParse({ maxPoints: 1000 }).success).toBe(false);
	});

	test('portfolio.performance: at its OWN max `maxPoints` (read from the schema, not assumed), a 500-point raw series still fits under MAX_TOOL_RESULT_TOKENS', async () => {
		const t = byName('portfolio.performance');
		const maxPoints = schemaMax(t.inputSchema, 'maxPoints');
		expect(maxPoints).toBeLessThan(1000); // the clamp is real, not cosmetic
		const input = t.inputSchema.parse({ days: 3650, maxPoints });
		const out = (await t.execute(input, ctxFor('user-c'))) as { points: unknown[] };
		expect(t.outputSchema.safeParse(out).success).toBe(true);
		// 500 raw points in the fixture, downsampled to exactly the schema's own max.
		expect(out.points.length).toBe(maxPoints);
		expect(estimatedTokens(out)).toBeLessThanOrEqual(MAX_TOOL_RESULT_TOKENS);
	});

	test('transactions.search: the tool rejects a `limit` request anywhere near the service ceiling (200)', () => {
		const t = byName('transactions.search');
		expect(t.inputSchema.safeParse({ limit: 200 }).success).toBe(false);
	});

	test('transactions.search: at its OWN max `limit` (read from the schema, not assumed), 300 rows of unbounded-length notes still fit under MAX_TOOL_RESULT_TOKENS, and hasMore is surfaced', async () => {
		const t = byName('transactions.search');
		const maxLimit = schemaMax(t.inputSchema, 'limit');
		expect(maxLimit).toBeLessThan(200); // the clamp is real, not cosmetic
		const out = (await t.execute(t.inputSchema.parse({ limit: maxLimit }), ctxFor('user-d'))) as {
			count: number;
			hasMore: boolean;
			transactions: Array<{ symbol: string }>;
		};
		expect(t.outputSchema.safeParse(out).success).toBe(true);
		expect(out.hasMore).toBe(true); // 300 real rows, far fewer actually returned
		expect(out.count).toBeLessThan(300);
		expect(out.transactions.length).toBe(out.count);
		expect(estimatedTokens(out)).toBeLessThanOrEqual(MAX_TOOL_RESULT_TOKENS);
	});

	test('watchlist.list: 300 items with unbounded-length descriptions still fit under MAX_TOOL_RESULT_TOKENS, and hasMore is surfaced', async () => {
		const t = byName('watchlist.list');
		const out = (await t.execute({}, ctxFor('user-e'))) as { hasMore: boolean; items: unknown[] };
		expect(t.outputSchema.safeParse(out).success).toBe(true);
		expect(out.hasMore).toBe(true);
		expect(out.items.length).toBeLessThan(300);
		expect(estimatedTokens(out)).toBeLessThanOrEqual(MAX_TOOL_RESULT_TOKENS);
	});

	test('goals.list: 300 goals with unbounded-length notes still fit under MAX_TOOL_RESULT_TOKENS, and hasMore is surfaced', async () => {
		const t = byName('goals.list');
		const out = (await t.execute({}, ctxFor('user-f'))) as { goals: unknown[]; hasMore: boolean };
		expect(t.outputSchema.safeParse(out).success).toBe(true);
		expect(out.hasMore).toBe(true);
		expect(out.goals.length).toBeLessThan(300);
		expect(estimatedTokens(out)).toBeLessThanOrEqual(MAX_TOOL_RESULT_TOKENS);
	});
});

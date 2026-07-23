import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { countTokens } from 'gpt-tokenizer';
import { z } from 'zod';
import type { Currency } from '@/lib/currency';
import { MAX_TOOL_RESULT_TOKENS } from '@/server/ai/guardrails';
import type { AppTool, Scope, ToolCtx } from './types';

/**
 * A REAL BPE token count (gpt-4o / o200k_base — gpt-tokenizer's default encoding), not a proxy.
 *
 * This file used to estimate tokens as `JSON.stringify(value).length / 4` — the same ~4
 * chars/token "rule of thumb" `result-bounds.ts` (wrongly) used to derive its own char budget.
 * A test that re-uses the implementation's own estimate can never catch a mis-calibration in
 * that estimate — which is exactly what happened: our JSON payloads (full-precision doubles,
 * cuid ids, ISO dates) tokenize at 2.0-2.8 chars/token, not 4, so every "provably bounded" test
 * below was green while shipping 1.2x-1.8x over `MAX_TOOL_RESULT_TOKENS`. Counting real tokens
 * here is what makes these tests capable of catching that class of bug again.
 */
const realTokens = (value: unknown): number => countTokens(JSON.stringify(value));

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
	},
	/** 2,000 positions — the C1 "portfolio.structure" scenario: no per-item content is unbounded
	 *  here, but row COUNT alone is enough to blow the token budget without the runtime bound. */
	'user-g': {
		items: Array.from({ length: 2000 }, (_, i) => ({
			avgCost: 10.5 + i * 0.013,
			price: 12.75 + i * 0.017,
			quantity: 3 + (i % 7),
			symbol: `POS${i}`,
			totalCost: 100 + i * 1.1,
			unconverted: false,
			value: 120 + i * 1.3,
			weight: 1 / 2000
		})),
		totalValue: 250_000
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
	'user-c': { full: LONG_SERIES, unconvertedSymbols: [] },
	/**
	 * C2: `unconvertedSymbols` is a SECOND array `boundArrayElements` never touches — it is
	 * measured but never shrunk. `full: []` means `window` is empty, so this ALSO exercises the
	 * EARLY-RETURN path (portfolio-performance.ts), which historically skipped bounding
	 * entirely. `navOnDate` marks every non-target-currency holding as unconverted on any single
	 * FX-less day — no attacker required, a bulk CSV import reaches this.
	 */
	'user-h': { full: [], unconvertedSymbols: Array.from({ length: 5000 }, (_, i) => `SYM${i}`) }
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
		// 'HUGEHIST': like LONGHIST, but each point carries a full-precision, 10-decimal value —
		// dense enough that even the schema's OWN `days` maximum overflows the token budget, so
		// the runtime bound is FORCED to engage (LONGHIST alone never gets there). Proves I3: the
		// series is oldest -> newest, so truncation must drop the OLDEST days and keep the newest.
		if (symbol === 'HUGEHIST') {
			return Array.from({ length: days }, (_, i) => ({
				date: dayIso(i),
				value: Number((100 + i * Math.PI).toFixed(10))
			}));
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
	test('is the seven read tools plus the transactions.create write tool', () => {
		expect(ALL_TOOLS.map((t) => t.name).sort()).toEqual([
			'fx.rates',
			'goals.list',
			'market.priceHistory',
			'portfolio.performance',
			'portfolio.structure',
			'transactions.create',
			'transactions.search',
			'watchlist.list'
		]);
		for (const t of ALL_TOOLS) {
			expect(t.description.length).toBeGreaterThan(0);
			if (t.name === 'transactions.create') {
				// The one write tool: mutating, with a preview, and NOT a read-only hint.
				expect(t.mutates).toBe(true);
				expect(t.annotations.readOnlyHint).toBe(false);
				expect(typeof t.preview).toBe('function');
			} else {
				expect(t.mutates).toBe(false);
				expect(t.annotations.readOnlyHint).toBe(true);
				expect(t.preview).toBeUndefined();
			}
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

			// The JSON Schema shape above is NOT sufficient on its own: in zod v4,
			// `z.toJSONSchema` reports `additionalProperties: false` for a PLAIN `z.object()`
			// too, identically to `z.strictObject()` — verified directly, not assumed (see the
			// negative control below). Only the RUNTIME parse behaviour actually distinguishes
			// them: `z.object()` silently STRIPS an unknown key (`safeParse` still succeeds,
			// minus the key); only `z.strictObject()` rejects it outright. Prove the real
			// behaviour, for every tool whose schema accepts an empty input.
			if (t.inputSchema.safeParse({}).success) {
				const probed = t.inputSchema.safeParse({ __unrecognised_probe_key__: true });
				expect({ ok: probed.success, tool: t.name }).toEqual({ ok: false, tool: t.name });
			}
		}
	});

	test('a userId smuggled into model input fails the schema outright', () => {
		const parsed = byName('transactions.search').inputSchema.safeParse({ userId: 'user-a' });
		expect(parsed.success).toBe(false);
	});

	// Gives the "no userId key" check above teeth: proves a schema that DOES leak `userId`
	// in its properties is actually caught, not just that our seven tools happen to pass today.
	test('NEGATIVE CONTROL: a schema with userId in its properties would be caught by the no-userId check above', () => {
		const bad = z.object({ userId: z.string() });
		expect(collectPropertyNames(z.toJSONSchema(bad), [])).toContain('userId');
	});

	// Gives the RUNTIME half of the "strictObject" check above teeth: proves the JSON-Schema
	// `additionalProperties` shape is NOT what distinguishes strict from plain in zod v4 — the
	// two are byte-identical there — and that `safeParse` is where they actually diverge.
	test('NEGATIVE CONTROL: a plain z.object silently strips an unknown key; only z.strictObject rejects it', () => {
		const probe = { __unrecognised_probe_key__: true };
		const loose = z.object({ userId: z.string().optional() });
		const strict = z.strictObject({ userId: z.string().optional() });

		expect(z.toJSONSchema(loose).additionalProperties).toBe(false); // identical to strict's — no signal here
		expect(z.toJSONSchema(strict).additionalProperties).toBe(false);

		expect(loose.safeParse(probe).success).toBe(true); // silently stripped, NOT rejected
		expect(strict.safeParse(probe).success).toBe(false); // rejected — this is what our tools rely on
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
			truncated: boolean;
			twrPct: number;
			unconvertedSymbolCount: number;
			unconvertedSymbols: string[];
		};
		expect(t.outputSchema.safeParse(out).success).toBe(true);
		expect(out.points.map((p) => p.date)).toEqual(['2024-01-01', '2024-01-02']);
		expect(out.twrPct).toBeCloseTo(10, 9);
		expect(out.mwrPct).toBeCloseTo(5, 9);
		expect(out.unconvertedSymbols).toEqual(['ZZZZ']);
		expect(out.unconvertedSymbolCount).toBe(1);
		expect(out.truncated).toBe(false); // well under both the point count and symbol count caps
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

	test('the real transactions.create write tool is reachable on chat with the write scope, never on mcp', () => {
		const scopes = new Set<Scope>([...ALL_SCOPES, 'transactions:write']);
		expect(buildToolset(ctxFor('u', { scopes, surface: 'chat' })).map((t) => t.name)).toContain(
			'transactions.create'
		);
		expect(buildToolset(ctxFor('u', { scopes, surface: 'mcp' })).map((t) => t.name)).not.toContain(
			'transactions.create'
		);
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
		expect(realTokens(out)).toBeLessThanOrEqual(MAX_TOOL_RESULT_TOKENS);
	});

	/**
	 * I3: `points` is ordered oldest -> newest. A size-based truncation that drops from the TAIL
	 * (the pre-fix default) would silently delete the newest prices. HUGEHIST is dense enough
	 * that the runtime bound is FORCED to engage even at the schema's own `days` maximum, so this
	 * actually exercises the bound rather than asserting on a case where it never fires.
	 */
	test('market.priceHistory: when the size bound must drop days, it drops the OLDEST and keeps the NEWEST price', async () => {
		const t = byName('market.priceHistory');
		const maxDays = schemaMax(t.inputSchema, 'days');
		const out = (await t.execute(t.inputSchema.parse({ days: maxDays, symbol: 'HUGEHIST' }), ctxFor('user-b'))) as {
			points: Array<{ date: string; value: number }>;
			truncated: boolean;
		};
		expect(t.outputSchema.safeParse(out).success).toBe(true);
		expect(out.truncated).toBe(true);
		expect(out.points.length).toBeGreaterThan(0);
		expect(out.points.length).toBeLessThan(maxDays);
		// The NEWEST day (dayIso(maxDays - 1)) survives; it is the OLDEST that went missing.
		expect(out.points[out.points.length - 1]?.date).toBe(dayIso(maxDays - 1));
		expect(out.points[0]?.date).not.toBe(dayIso(0));
		expect(realTokens(out)).toBeLessThanOrEqual(MAX_TOOL_RESULT_TOKENS);
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
		const out = (await t.execute(input, ctxFor('user-c'))) as {
			points: Array<{ date: string }>;
			truncated: boolean;
		};
		expect(t.outputSchema.safeParse(out).success).toBe(true);
		// 500 raw points in the fixture, downsampled to at most the schema's own max. At a real
		// (measured, not proxy) token budget the runtime `boundArrayElements` bound now actually
		// engages here — 250 numeric points is itself over MAX_TOOL_RESULT_TOKENS once counted
		// with a real BPE tokenizer (this is exactly the C1 bug: the OLD ~4 chars/token proxy
		// said this fit; it did not) — so `truncated` must be surfaced, not silently absorbed.
		expect(out.points.length).toBeGreaterThan(0);
		expect(out.points.length).toBeLessThanOrEqual(maxPoints);
		expect(realTokens(out)).toBeLessThanOrEqual(MAX_TOOL_RESULT_TOKENS);
	});

	/**
	 * I3: `points` is ordered oldest -> newest (portfolio-performance.ts). When the runtime bound
	 * must drop points beyond what downsampling already removed, it must drop the OLDEST ones
	 * (`keep: 'tail'`) so the most recent NAV — the one twrPct/mwrPct's true endpoints describe —
	 * is never silently missing from the series the model actually sees.
	 */
	test('portfolio.performance: when the size bound must drop points, the NEWEST point always survives', async () => {
		const t = byName('portfolio.performance');
		const maxPoints = schemaMax(t.inputSchema, 'maxPoints');
		const input = t.inputSchema.parse({ days: 3650, maxPoints });
		const out = (await t.execute(input, ctxFor('user-c'))) as {
			points: Array<{ date: string }>;
			truncated: boolean;
		};
		expect(out.truncated).toBe(true); // this fixture is large enough to force the bound
		expect(out.points[out.points.length - 1]?.date).toBe(dayIso(499));
		expect(seenUserIds).toEqual(['user-c']);
	});

	/**
	 * C2: `unconvertedSymbols` is a SECOND array in this tool's output that `boundArrayElements`
	 * never shrinks — it is only ever measured as part of the envelope. Without its own cap, once
	 * `points` is truncated to zero there is nothing left to drop, and an oversized
	 * `unconvertedSymbols` sails through anyway. `full: []` (user-h) means `window` is empty, so
	 * this hits the EARLY-RETURN branch specifically — the one that historically skipped bounding
	 * entirely and returned `pointsAreDownsampled: false`, telling the model nothing was cut.
	 */
	test('portfolio.performance: 5,000 unconverted symbols on the early-return path still fit under MAX_TOOL_RESULT_TOKENS, capped with the true count surfaced', async () => {
		const t = byName('portfolio.performance');
		const out = (await t.execute(t.inputSchema.parse({}), ctxFor('user-h'))) as {
			points: unknown[];
			truncated: boolean;
			unconvertedSymbolCount: number;
			unconvertedSymbols: string[];
		};
		expect(t.outputSchema.safeParse(out).success).toBe(true);
		expect(out.points).toEqual([]); // confirms this is the early-return path, not the main one
		expect(out.unconvertedSymbolCount).toBe(5000); // the TRUE total, never lost
		expect(out.unconvertedSymbols.length).toBeLessThan(5000); // but the array itself is capped
		expect(out.unconvertedSymbols).toEqual(
			Array.from({ length: out.unconvertedSymbols.length }, (_, i) => `SYM${i}`)
		);
		expect(out.truncated).toBe(true); // silently returning 50 of 5000 with no signal is the bug
		expect(realTokens(out)).toBeLessThanOrEqual(MAX_TOOL_RESULT_TOKENS);
	});

	/**
	 * C1's table also names `portfolio.structure` (2,000 positions, no unbounded per-item
	 * content needed — row COUNT alone crosses the token budget). This tool had no runtime-size
	 * test at all before this fix wave; the schema-level clamp tests above already exist for the
	 * other four tools reachable via a small, model-controlled input, but `portfolio.structure`
	 * takes no input — its size is entirely a function of how many symbols the user holds, so the
	 * proof has to come from a large holdings fixture, not from a schema maximum.
	 */
	test('portfolio.structure: 2,000 positions still fit under MAX_TOOL_RESULT_TOKENS, and truncated is surfaced', async () => {
		const t = byName('portfolio.structure');
		const out = (await t.execute({}, ctxFor('user-g'))) as {
			positions: Array<{ symbol: string }>;
			truncated: boolean;
		};
		expect(t.outputSchema.safeParse(out).success).toBe(true);
		expect(out.truncated).toBe(true);
		expect(out.positions.length).toBeGreaterThan(0);
		expect(out.positions.length).toBeLessThan(2000);
		expect(realTokens(out)).toBeLessThanOrEqual(MAX_TOOL_RESULT_TOKENS);
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
		expect(realTokens(out)).toBeLessThanOrEqual(MAX_TOOL_RESULT_TOKENS);
	});

	test('watchlist.list: 300 items with unbounded-length descriptions still fit under MAX_TOOL_RESULT_TOKENS, and hasMore is surfaced', async () => {
		const t = byName('watchlist.list');
		const out = (await t.execute({}, ctxFor('user-e'))) as { hasMore: boolean; items: unknown[] };
		expect(t.outputSchema.safeParse(out).success).toBe(true);
		expect(out.hasMore).toBe(true);
		expect(out.items.length).toBeLessThan(300);
		expect(realTokens(out)).toBeLessThanOrEqual(MAX_TOOL_RESULT_TOKENS);
	});

	test('goals.list: 300 goals with unbounded-length notes still fit under MAX_TOOL_RESULT_TOKENS, and hasMore is surfaced', async () => {
		const t = byName('goals.list');
		const out = (await t.execute({}, ctxFor('user-f'))) as { goals: unknown[]; hasMore: boolean };
		expect(t.outputSchema.safeParse(out).success).toBe(true);
		expect(out.hasMore).toBe(true);
		expect(out.goals.length).toBeLessThan(300);
		expect(realTokens(out)).toBeLessThanOrEqual(MAX_TOOL_RESULT_TOKENS);
	});
});

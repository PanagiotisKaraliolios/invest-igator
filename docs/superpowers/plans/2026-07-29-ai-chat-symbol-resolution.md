# AI Chat — Symbol Resolution, On-Demand Fetch & Disambiguation Picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the assistant is asked about a ticker it has no data for, fetch it on demand instead of answering "no data"; and when a name/root is ambiguous (VUAA → `.L` / `.DE` / `.MI` / …), show a clickable list of the real listings so the user picks one.

**Architecture:** A new read-only `symbol.search` tool wraps the existing Yahoo symbol search, so the model can resolve a name to concrete tickers. `market.priceHistory` gains an existence-gated, single-attempt backfill through the existing `ingestYahooSymbol`, which writes to InfluxDB and therefore caches for every later turn. The candidate list renders as a clickable artifact; clicking sends a normal user turn naming the chosen ticker, via a small React context that exposes the chat's own `sendMessage` to artifacts.

**Tech Stack:** TypeScript, Next.js 16, AI SDK v7, zod v4, InfluxDB, `bun test`.

**Spec:** `docs/superpowers/specs/2026-07-26-ai-chat-symbol-resolution-design.md`

## Global Constraints

- **The tool surface is read-only.** `symbol.search` is `mutates: false`, scope `watchlist:read` (the same scope `market.priceHistory` uses — do NOT invent a new scope).
- **Tool names must be `group.verb` with NO underscore.** The AI SDK adapter maps `.` → `_`, and that mapping is only reversible while canonical names are underscore-free (`registry.test.ts` enforces this).
- **A tool must never throw out of a chat turn.** Every new failure path degrades to an empty/quiet result and logs for ops, exactly as `market.priceHistory` already does.
- **The backfill is existence-gated and single-attempt**: only when Influx has nothing for the symbol AND Yahoo says it exists, and it never retries within one call.
- **Never log or embed user-identifying data in tool logs.** These logs already carry symbols only; keep it that way.
- Every tool result must stay within the measured token bound — new array-returning tools use `boundArrayElements`, and `registry.test.ts`'s "provably bounded" coverage must include the new tool.
- The prompt module `src/server/ai/prompts/portfolio-analyst.ts` is FROZEN/VERSIONED: any `TEXT` edit requires bumping `version` **and** adding a new hardcoded `GOLDEN_HASHES` entry (never edit an existing one). It must stay dependency-free (no env access, no env-module import, no toggle-shaped identifier). It currently ships **version 3**, golden hash `481409293724dc1edc78df292b55b2bcd558e5b37188a7825dba844f10774a86`.
- Client artifact modules may import server tool modules **only** with `import type` (erased at compile time) — a runtime import would pull `@/server/db` into the client bundle. `tsconfig.json` has `verbatimModuleSyntax: true`, which enforces this.

---

### Task 1: `symbol.search` tool

**Files:**
- Create: `src/server/ai/tools/symbol-search.ts`
- Modify: `src/server/ai/tools/registry.ts`
- Create: `src/server/ai/tools/symbol-search.test.ts`

**Interfaces:**
- Consumes: `searchYahooSymbols(q: string): Promise<YahooSearchResult[]>` where `YahooSearchResult = { symbol; description; type; exchange }` — from `@/server/yahoo-search`.
- Produces: `symbolSearchTool` (an `AppTool`) whose output is `{ query: string; candidates: Array<{ symbol; name; exchange; type }>; truncated: boolean }` — consumed by Task 3's renderer and Task 4's prompt text.

- [ ] **Step 1: Write the failing test**

Create `src/server/ai/tools/symbol-search.test.ts`:

```ts
import { describe, expect, mock, test } from 'bun:test';

const searchYahooSymbols = mock(async (_q: string) => [] as Array<Record<string, string>>);
mock.module('@/server/yahoo-search', () => ({ searchYahooSymbols }));

const { symbolSearchTool } = await import('./symbol-search');

const CTX = {} as never;

describe('symbol.search', () => {
	test('maps Yahoo results to candidates', async () => {
		searchYahooSymbols.mockResolvedValueOnce([
			{ description: 'Vanguard S&P 500 UCITS ETF', exchange: 'London', symbol: 'VUAA.L', type: 'ETF' },
			{ description: 'Vanguard S&P 500 UCITS ETF USD Acc', exchange: 'XETRA', symbol: 'VUAA.DE', type: 'ETF' }
		]);

		const out = await symbolSearchTool.execute({ query: 'VUAA' }, CTX);

		expect(out.query).toBe('VUAA');
		expect(out.candidates).toEqual([
			{ exchange: 'London', name: 'Vanguard S&P 500 UCITS ETF', symbol: 'VUAA.L', type: 'ETF' },
			{ exchange: 'XETRA', name: 'Vanguard S&P 500 UCITS ETF USD Acc', symbol: 'VUAA.DE', type: 'ETF' }
		]);
	});

	test('caps the candidate list', async () => {
		searchYahooSymbols.mockResolvedValueOnce(
			Array.from({ length: 25 }, (_, i) => ({
				description: `Name ${i}`,
				exchange: 'X',
				symbol: `SYM${i}`,
				type: 'EQUITY'
			}))
		);

		const out = await symbolSearchTool.execute({ query: 'many' }, CTX);

		expect(out.candidates.length).toBeLessThanOrEqual(8);
		expect(out.truncated).toBe(true);
	});

	test('an empty result is not an error', async () => {
		searchYahooSymbols.mockResolvedValueOnce([]);
		const out = await symbolSearchTool.execute({ query: 'zzzz' }, CTX);
		expect(out.candidates).toEqual([]);
		expect(out.truncated).toBe(false);
	});

	test('a provider failure degrades to no candidates rather than throwing', async () => {
		searchYahooSymbols.mockImplementationOnce(async () => {
			throw new Error('yahoo down');
		});
		const out = await symbolSearchTool.execute({ query: 'VUAA' }, CTX);
		expect(out.candidates).toEqual([]);
	});

	test('is read-only and shares the watchlist scope', () => {
		expect(symbolSearchTool.mutates).toBe(false);
		expect(symbolSearchTool.requiredScope).toBe('watchlist:read');
		expect(symbolSearchTool.name).toBe('symbol.search');
		expect(symbolSearchTool.name).not.toContain('_');
	});
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test src/server/ai/tools/symbol-search.test.ts`
Expected: FAIL — `Cannot find module './symbol-search'`.

- [ ] **Step 3: Implement the tool**

Create `src/server/ai/tools/symbol-search.ts`:

```ts
import { z } from 'zod';
import { searchYahooSymbols } from '@/server/yahoo-search';
import type { AppTool } from './types';

/**
 * Enough listings to disambiguate a multi-exchange ETF (VUAA lists on ~6 venues) without
 * spending the tool-result budget on a long tail the user will never pick.
 */
const MAX_CANDIDATES = 8;

const inputSchema = z.strictObject({
	query: z.string().min(1).max(64)
});

const outputSchema = z.strictObject({
	candidates: z.array(
		z.strictObject({
			exchange: z.string(),
			name: z.string(),
			symbol: z.string(),
			type: z.string()
		})
	),
	query: z.string(),
	/** true when more listings matched than were returned. */
	truncated: z.boolean()
});

/**
 * Resolve a company/fund name or an ambiguous ticker root to concrete, tradeable tickers.
 *
 * Exists because `market.priceHistory` takes an exact symbol and returns an empty series for
 * anything else: without this, "the price of VUAA" is a dead end, since VUAA alone is not a
 * ticker — VUAA.L, VUAA.DE and VUAA.MI are, and they are different listings of one fund.
 *
 * Same `watchlist:read` scope as `market.priceHistory`: this is public reference data with no
 * tenant dimension, so it takes no userId.
 */
export const symbolSearchTool: AppTool<typeof inputSchema, typeof outputSchema> = {
	annotations: { openWorldHint: true, readOnlyHint: true, title: 'Symbol search' },
	description:
		'Find tradeable tickers matching a company/fund name or an ambiguous ticker root. Returns candidate listings (symbol, name, exchange, type) — one per exchange, so the same fund appears several times. Use this whenever the user names an instrument that is not already an exact ticker, or when market.priceHistory returned an empty series. Present the candidates and let the user choose; do NOT guess a listing on their behalf.',
	execute: async (input) => {
		let results: Awaited<ReturnType<typeof searchYahooSymbols>>;
		try {
			results = await searchYahooSymbols(input.query);
		} catch (err) {
			// Degrade like every other tool: an unreachable provider must not kill the chat turn.
			console.error(`symbol.search: lookup failed for ${input.query}:`, err);
			results = [];
		}

		const candidates = results.slice(0, MAX_CANDIDATES).map((r) => ({
			exchange: r.exchange,
			name: r.description,
			symbol: r.symbol,
			type: r.type
		}));

		return { candidates, query: input.query, truncated: results.length > candidates.length };
	},
	inputSchema,
	mutates: false,
	name: 'symbol.search',
	outputSchema,
	requiredScope: 'watchlist:read'
};
```

- [ ] **Step 4: Register it**

In `src/server/ai/tools/registry.ts`, import `symbolSearchTool` and add it to `ALL_TOOLS`, immediately after `marketPriceHistoryTool` (the two are used together):

```ts
	marketPriceHistoryTool,
	symbolSearchTool,
```

- [ ] **Step 5: Run the tool test AND the registry test**

Run: `bun test src/server/ai/tools/symbol-search.test.ts src/server/ai/tools/registry.test.ts`
Expected: the 5 new tests pass. `registry.test.ts` may fail if it asserts an exact tool count or enumerates tools for its "provably bounded" coverage — if so, extend it to include `symbol.search` (a bounded case with `MAX_CANDIDATES` maximal-length strings). Do NOT delete or weaken an existing assertion to make it pass.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
bun run typecheck && bunx @biomejs/biome check --write src/server/ai/tools/symbol-search.ts src/server/ai/tools/symbol-search.test.ts src/server/ai/tools/registry.ts
git add src/server/ai/tools/symbol-search.ts src/server/ai/tools/symbol-search.test.ts src/server/ai/tools/registry.ts src/server/ai/tools/registry.test.ts
git commit -m "feat(ai): symbol.search tool resolves a name to concrete tickers"
```

---

### Task 2: `market.priceHistory` fetches a symbol it has never seen

**Files:**
- Modify: `src/server/ai/tools/market-price-history.ts`
- Create: `src/server/ai/tools/market-price-history-backfill.test.ts`

**Interfaces:**
- Consumes: `symbolHasAnyData(symbol): Promise<boolean>` from `@/server/influx`; `symbolExistsOnYahoo(symbol): Promise<'yes'|'no'|'unreachable'>` from `@/server/yahoo-search`; `ingestYahooSymbol(symbol, options?)` from `@/server/jobs/yahoo-lib`.
- Produces: the same output plus `fetched: boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/server/ai/tools/market-price-history-backfill.test.ts`:

```ts
import { beforeEach, describe, expect, mock, test } from 'bun:test';

const getPriceHistory = mock(async (_s: string, _d: number, _f: string) => [] as Array<{ date: string; value: number }>);
const symbolHasAnyData = mock(async (_s: string) => false);
const symbolExistsOnYahoo = mock(async (_s: string) => 'no' as 'yes' | 'no' | 'unreachable');
const ingestYahooSymbol = mock(async (_s: string) => ({}) as never);

mock.module('@/server/services/market', () => ({ getPriceHistory }));
mock.module('@/server/influx', () => ({ symbolHasAnyData }));
mock.module('@/server/yahoo-search', () => ({ symbolExistsOnYahoo }));
mock.module('@/server/jobs/yahoo-lib', () => ({ ingestYahooSymbol }));

const { marketPriceHistoryTool } = await import('./market-price-history');

const CTX = {} as never;
const POINTS = [{ date: '2026-07-24', value: 115.07 }];

beforeEach(() => {
	getPriceHistory.mockReset();
	symbolHasAnyData.mockReset();
	symbolExistsOnYahoo.mockReset();
	ingestYahooSymbol.mockReset();
});

describe('market.priceHistory on-demand backfill', () => {
	test('does not fetch when the symbol already has data', async () => {
		getPriceHistory.mockResolvedValue(POINTS);

		const out = await marketPriceHistoryTool.execute({ days: 90, field: 'close', symbol: 'AAPL' }, CTX);

		expect(out.points).toEqual(POINTS);
		expect(out.fetched).toBe(false);
		expect(ingestYahooSymbol).not.toHaveBeenCalled();
	});

	test('fetches, then re-queries, when the symbol is unknown but exists on Yahoo', async () => {
		getPriceHistory.mockResolvedValueOnce([]).mockResolvedValueOnce(POINTS);
		symbolHasAnyData.mockResolvedValue(false);
		symbolExistsOnYahoo.mockResolvedValue('yes');

		const out = await marketPriceHistoryTool.execute({ days: 90, field: 'close', symbol: 'VUAA.L' }, CTX);

		expect(ingestYahooSymbol).toHaveBeenCalledTimes(1);
		expect(out.points).toEqual(POINTS);
		expect(out.fetched).toBe(true);
	});

	test('does NOT fetch a symbol Yahoo does not know', async () => {
		getPriceHistory.mockResolvedValue([]);
		symbolHasAnyData.mockResolvedValue(false);
		symbolExistsOnYahoo.mockResolvedValue('no');

		const out = await marketPriceHistoryTool.execute({ days: 90, field: 'close', symbol: 'NOPE' }, CTX);

		expect(ingestYahooSymbol).not.toHaveBeenCalled();
		expect(out.points).toEqual([]);
		expect(out.fetched).toBe(false);
	});

	test('does NOT fetch when the symbol is already stored but the window is empty', async () => {
		// A delisted/stale symbol legitimately has no points in the trailing window — refetching
		// it on every turn would hammer Yahoo for nothing.
		getPriceHistory.mockResolvedValue([]);
		symbolHasAnyData.mockResolvedValue(true);

		await marketPriceHistoryTool.execute({ days: 90, field: 'close', symbol: 'OLD' }, CTX);

		expect(symbolExistsOnYahoo).not.toHaveBeenCalled();
		expect(ingestYahooSymbol).not.toHaveBeenCalled();
	});

	test('a failing backfill degrades to an empty series instead of throwing', async () => {
		getPriceHistory.mockResolvedValue([]);
		symbolHasAnyData.mockResolvedValue(false);
		symbolExistsOnYahoo.mockResolvedValue('yes');
		ingestYahooSymbol.mockImplementationOnce(async () => {
			throw new Error('ingest exploded');
		});

		const out = await marketPriceHistoryTool.execute({ days: 90, field: 'close', symbol: 'VUAA.L' }, CTX);

		expect(out.points).toEqual([]);
		expect(out.fetched).toBe(false);
	});
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test src/server/ai/tools/market-price-history-backfill.test.ts`
Expected: FAIL — `fetched` is undefined and `ingestYahooSymbol` is never called.

- [ ] **Step 3: Add `fetched` to the output schema**

In `src/server/ai/tools/market-price-history.ts`, add to `outputSchema` (keys stay alphabetical):

```ts
const outputSchema = z.strictObject({
	field: fieldSchema,
	/** true when this call fetched the symbol's history on demand before answering. */
	fetched: z.boolean(),
	points: z.array(z.strictObject({ date: z.string(), value: z.number() })),
	symbol: z.string(),
	/** true when `points` is a prefix rather than the whole requested window. */
	truncated: z.boolean()
});
```

- [ ] **Step 4: Implement the backfill**

Add the imports:

```ts
import { symbolHasAnyData } from '@/server/influx';
import { ingestYahooSymbol } from '@/server/jobs/yahoo-lib';
import { symbolExistsOnYahoo } from '@/server/yahoo-search';
```

Then, inside `execute`, replace the existing fetch block:

```ts
		let points: Awaited<ReturnType<typeof getPriceHistory>>;
		try {
			points = await getPriceHistory(input.symbol, input.days, input.field);
		} catch (err) {
			console.error(`market.priceHistory: price data unavailable for ${input.symbol}:`, err);
			points = [];
		}
```

with:

```ts
		let points: Awaited<ReturnType<typeof getPriceHistory>> = [];
		let fetched = false;
		try {
			points = await getPriceHistory(input.symbol, input.days, input.field);

			// An empty series for a symbol we have NEVER stored usually means "nobody has asked for
			// this ticker yet", not "this ticker has no prices". Fetch it once, on demand, then
			// re-query. `ingestYahooSymbol` writes to Influx, so the next turn — and every other
			// user — hits the cache instead of Yahoo.
			//
			// Gated deliberately: `symbolHasAnyData` first, so a delisted symbol that legitimately
			// has no points in the trailing window is not refetched on every single turn; then
			// `symbolExistsOnYahoo`, so a typo never triggers a full-history ingest.
			if (points.length === 0 && !(await symbolHasAnyData(input.symbol))) {
				if ((await symbolExistsOnYahoo(input.symbol)) === 'yes') {
					await ingestYahooSymbol(input.symbol);
					fetched = true;
					points = await getPriceHistory(input.symbol, input.days, input.field);
				}
			}
		} catch (err) {
			// Degrade gracefully: an unreachable/slow data source (e.g. Influx down) must NOT throw out
			// of a chat turn — that leaves the assistant with a silent, empty reply. Treat any failure
			// the same as "no data" (the documented empty-series contract) and log it for ops.
			console.error(`market.priceHistory: price data unavailable for ${input.symbol}:`, err);
			points = [];
			fetched = false;
		}
```

Then include `fetched` in BOTH the `boundArrayElements` builder object and the returned object:

```ts
			const bounded = boundArrayElements(
				points,
				(slice) => ({
					fetched,
					field: input.field,
					points: slice,
					symbol: input.symbol,
					truncated: false
				}),
				{ keep: 'tail' }
			);
			return {
				fetched,
				field: input.field,
				points: bounded.items,
				symbol: input.symbol,
				truncated: bounded.truncated
			};
```

- [ ] **Step 5: Update the tool description**

Still in the same file, replace the sentence `Returns an empty series for an unknown or malformed symbol.` inside `description` with:

```
Returns an empty series for a malformed symbol, or for one that does not exist. A symbol this app has never seen is fetched on demand before answering (`fetched` is then true), so a first-time empty result does NOT mean the instrument has no prices — if the series is still empty, call symbol.search to find the right listing.
```

- [ ] **Step 6: Run the tests**

Run: `bun test src/server/ai/tools/market-price-history-backfill.test.ts src/server/ai/tools/registry.test.ts`
Expected: 5 new tests pass; `registry.test.ts` still passes (extend its bounded-coverage case for the new `fetched` field only if it fails).

- [ ] **Step 7: Typecheck, lint, commit**

```bash
bun run typecheck && bunx @biomejs/biome check --write src/server/ai/tools/market-price-history.ts src/server/ai/tools/market-price-history-backfill.test.ts
git add src/server/ai/tools/market-price-history.ts src/server/ai/tools/market-price-history-backfill.test.ts
git commit -m "feat(ai): fetch a never-seen symbol on demand instead of answering no data"
```

---

### Task 3: Clickable disambiguation picker

**Files:**
- Create: `src/app/(dashboard)/_components/chat/chat-actions.tsx`
- Create: `src/app/(dashboard)/_components/chat/artifacts/symbol-picker.tsx`
- Modify: `src/app/(dashboard)/_components/chat/artifacts/registry.ts`
- Modify: `src/app/(dashboard)/_components/chat/chat-launcher.tsx`
- Create: `src/app/(dashboard)/_components/chat/artifacts/symbol-picker.helpers.ts`
- Create: `src/app/(dashboard)/_components/chat/artifacts/symbol-picker.helpers.test.ts`

**Interfaces:**
- Consumes: `symbolSearchTool`'s output type (Task 1) — **`import type` only**.
- Produces: `ChatActionsProvider` / `useChatActions`, and a `symbol.search` entry in `ARTIFACT_RENDERERS`.

- [ ] **Step 1: Create the chat-actions context**

Artifacts are rendered deep inside the message list, and `renderArtifact(toolName, part)` takes no callback. Rather than thread one through four components, expose the chat's own send function by context.

Create `src/app/(dashboard)/_components/chat/chat-actions.tsx`:

```tsx
'use client';

import { createContext, type ReactNode, useContext, useMemo } from 'react';

type ChatActions = {
	/** Sends a normal user turn. Same function the composer uses. */
	sendMessage: (text: string) => void;
};

const ChatActionsContext = createContext<ChatActions | null>(null);

/**
 * Gives chat artifacts a way to start a new user turn (e.g. the symbol picker sending the
 * ticker the user clicked). `renderArtifact` takes no callbacks, and threading one through
 * drawer -> thread -> message -> renderer would couple four components to one artifact's needs.
 */
export function ChatActionsProvider({
	children,
	sendMessage
}: {
	children: ReactNode;
	sendMessage: (text: string) => void;
}) {
	const value = useMemo(() => ({ sendMessage }), [sendMessage]);
	return <ChatActionsContext.Provider value={value}>{children}</ChatActionsContext.Provider>;
}

/** `null` outside a chat (e.g. a standalone render), so artifacts degrade to non-interactive. */
export function useChatActions(): ChatActions | null {
	return useContext(ChatActionsContext);
}
```

- [ ] **Step 2: Write the failing helper test**

Create `src/app/(dashboard)/_components/chat/artifacts/symbol-picker.helpers.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { pickMessage } from './symbol-picker.helpers';

describe('pickMessage', () => {
	test('names the exact ticker so the model does not have to re-resolve it', () => {
		expect(pickMessage('VUAA.L')).toBe('Use VUAA.L');
	});

	test('trims surrounding whitespace', () => {
		expect(pickMessage('  VUAA.DE  ')).toBe('Use VUAA.DE');
	});
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `bun test "src/app/(dashboard)/_components/chat/artifacts/symbol-picker.helpers.test.ts"`
Expected: FAIL — `Cannot find module './symbol-picker.helpers'`.

- [ ] **Step 4: Implement the helper**

Create `src/app/(dashboard)/_components/chat/artifacts/symbol-picker.helpers.ts`:

```ts
/**
 * The user turn a picked candidate produces. Kept as a pure function so the wording is
 * testable without rendering the chat.
 */
export function pickMessage(symbol: string): string {
	return `Use ${symbol.trim()}`;
}
```

- [ ] **Step 5: Implement the picker**

Create `src/app/(dashboard)/_components/chat/artifacts/symbol-picker.tsx`:

```tsx
'use client';

import { type ReactNode, useState } from 'react';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
// `import type` only — erased at compile time, so the tool module (and its server import
// chain) never enters the client bundle. Same boundary trick as confirm-card.
import type { symbolSearchTool } from '@/server/ai/tools/symbol-search';
import { useChatActions } from '../chat-actions';
import { pickMessage } from './symbol-picker.helpers';

type SearchOutput = z.infer<typeof symbolSearchTool.outputSchema>;

/**
 * The candidate listings for an ambiguous symbol, as clickable rows. One fund lists on several
 * exchanges (VUAA.L, VUAA.DE, VUAA.MI are all the same Vanguard ETF), and only the user knows
 * which one they hold — so the model presents, and the user picks.
 *
 * Clicking sends a normal user turn naming the ticker; the model then continues with an exact
 * symbol. Nothing here writes to the app.
 */
export function SymbolPicker({ output }: { output: unknown }): ReactNode {
	const out = output as SearchOutput | null;
	const actions = useChatActions();
	const [picked, setPicked] = useState<string | null>(null);

	if (!out || !Array.isArray(out.candidates) || out.candidates.length === 0) {
		return <p className='text-muted-foreground text-xs'>No matching listings found.</p>;
	}

	if (picked !== null) {
		return <p className='text-xs'>✓ Using {picked}.</p>;
	}

	return (
		<div className='space-y-2'>
			<p className='text-muted-foreground text-xs'>
				{out.candidates.length} listing{out.candidates.length === 1 ? '' : 's'} matched “{out.query}”. Pick the
				one you mean:
			</p>
			<div className='flex flex-col gap-1'>
				{out.candidates.map((c) => (
					<Button
						className='h-auto justify-start py-1.5 text-left'
						disabled={actions === null}
						key={c.symbol}
						onClick={() => {
							setPicked(c.symbol);
							actions?.sendMessage(pickMessage(c.symbol));
						}}
						size='sm'
						type='button'
						variant='outline'
					>
						<span className='font-medium'>{c.symbol}</span>
						<span className='text-muted-foreground text-xs'>
							{c.exchange}
							{c.name ? ` · ${c.name}` : ''}
						</span>
					</Button>
				))}
			</div>
			{out.truncated ? (
				<p className='text-muted-foreground text-xs'>More listings exist — narrow the name to see others.</p>
			) : null}
		</div>
	);
}
```

- [ ] **Step 6: Register the renderer**

In `src/app/(dashboard)/_components/chat/artifacts/registry.ts`, import `SymbolPicker` and add the entry (keys stay alphabetical):

```ts
	'symbol.search': (o) => createElement(SymbolPicker, { output: o as never }),
```

- [ ] **Step 7: Provide the context from the chat**

In `src/app/(dashboard)/_components/chat/chat-launcher.tsx`, import `ChatActionsProvider` and wrap the rendered `<ChatDrawer …/>` in it, reusing the SAME send function the composer already uses:

```tsx
					<ChatActionsProvider sendMessage={(text) => void sendMessage({ text })}>
						<ChatDrawer
							… existing props unchanged …
						/>
					</ChatActionsProvider>
```

- [ ] **Step 8: Run the tests + full gate**

```bash
bun test "src/app/(dashboard)/_components/chat/artifacts/symbol-picker.helpers.test.ts"
bun run typecheck && bun run check && bun run test:unit
```

Expected: 2 helper tests pass; typecheck 0; biome clean; unit suite green with no new failures.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(dashboard)/_components/chat/chat-actions.tsx" "src/app/(dashboard)/_components/chat/artifacts/symbol-picker.tsx" "src/app/(dashboard)/_components/chat/artifacts/symbol-picker.helpers.ts" "src/app/(dashboard)/_components/chat/artifacts/symbol-picker.helpers.test.ts" "src/app/(dashboard)/_components/chat/artifacts/registry.ts" "src/app/(dashboard)/_components/chat/chat-launcher.tsx"
git commit -m "feat(ai): clickable disambiguation picker for ambiguous symbols"
```

---

### Task 4: Teach the prompt to resolve before it answers

**Files:**
- Modify: `src/server/ai/prompts/portfolio-analyst.ts`
- Modify: `src/server/ai/prompts/portfolio-analyst.test.ts`

**Interfaces:**
- Consumes: the tool names `symbol.search` and `market.priceHistory` (Tasks 1–2).

- [ ] **Step 1: Add a symbol-resolution section to `TEXT`**

In `src/server/ai/prompts/portfolio-analyst.ts`, insert this section into `TEXT` immediately BEFORE the `## The boundary you may never cross` heading:

```
## Naming instruments

A ticker is exact. "VUAA", "Vanguard S&P 500" and "Apple" are not tickers — VUAA.L, VUAA.DE
and VUAA.MI are three listings of one fund, in different currencies and venues, and only the
user knows which one they mean.

When the user names an instrument that is not already an exact ticker, or when
market.priceHistory returns an empty series, call symbol.search and let the user choose from
the listings it returns. Do not guess a listing, and do not silently answer for one listing
when several matched. If the user has already named an exact ticker, use it directly.

An empty series from market.priceHistory does not by itself mean the instrument has no
prices: a symbol this app has never seen is fetched on demand, so say what you actually
found rather than declaring the instrument unavailable.
```

- [ ] **Step 2: Bump the version**

In the same file, change `version: 3` to `version: 4`.

- [ ] **Step 3: Compute the new golden hash**

Run:

```bash
bun -e "import {PORTFOLIO_ANALYST} from './src/server/ai/prompts/portfolio-analyst.ts'; console.log(PORTFOLIO_ANALYST.hash)"
```

Record the printed 64-hex string as `<NEW_HASH>`.

- [ ] **Step 4: Repin and extend the guard test**

In `src/server/ai/prompts/portfolio-analyst.test.ts`:

(a) Add the version-4 entry to `GOLDEN_HASHES` (leave 2 and 3 untouched):

```ts
const GOLDEN_HASHES: Record<number, string> = {
	2: 'cecfc9fbe2d2d35e4192aa629791340e4b2694b2bad9ce2a94a79925fb9b43c3',
	3: '481409293724dc1edc78df292b55b2bcd558e5b37188a7825dba844f10774a86',
	4: '<NEW_HASH>'
};
```

(b) Update the version pin: `expect(PORTFOLIO_ANALYST.version).toBe(4);`

(c) Add a new describe block asserting the new guidance is present:

```ts
describe('symbol resolution', () => {
	test('tells the model to resolve an ambiguous instrument rather than guess a listing', () => {
		expect(PORTFOLIO_ANALYST.text).toContain('symbol.search');
		expect(PORTFOLIO_ANALYST.text).toContain('Do not guess a listing');
	});

	test('warns that an empty series is not proof the instrument has no prices', () => {
		expect(PORTFOLIO_ANALYST.text).toContain('fetched on demand');
	});
});
```

- [ ] **Step 5: Run the guard test**

Run: `bun test src/server/ai/prompts/portfolio-analyst.test.ts`
Expected: all pass — version pin (4), golden hash, retained Art 50 substrings, off-switch scan, MiFID assertions, and the 2 new ones. If the golden-hash pin fails, `<NEW_HASH>` was mis-copied — re-run Step 3.

- [ ] **Step 6: Full gate and commit**

```bash
bun run typecheck && bun run check && bun run test:unit
git add src/server/ai/prompts/portfolio-analyst.ts src/server/ai/prompts/portfolio-analyst.test.ts
git commit -m "feat(ai): prompt resolves ambiguous instruments before answering"
```

---

## Self-Review

- **Spec coverage:** spec component 1 (`symbol.search`) → Task 1; component 2 (auto-backfill) → Task 2; component 3 (picker artifact) → Task 3 Steps 5–6; component 4 (click → `sendMessage` wiring) → Task 3 Steps 1, 7; component 5 (prompt) → Task 4.
- **Deviation from the spec:** the spec proposed threading an `onPick` callback from `chat-launcher` through `chat-drawer → message-thread → message → renderToolPart`. That would change `renderArtifact`'s signature and couple four components to one artifact's needs. This plan uses a React context instead — same behaviour, no signature change, and artifacts degrade to non-interactive when rendered outside a chat.
- **Placeholder scan:** only `<NEW_HASH>` (Task 4), an intentional runtime-computed value produced by Step 3. Every other step carries complete code.
- **Type consistency:** `symbolSearchTool`'s `outputSchema` (Task 1) is the exact shape `SearchOutput` infers in Task 3; `fetched: boolean` is added to `market.priceHistory`'s schema, its `boundArrayElements` builder AND its return (Task 2 Step 4) so the three cannot drift; `pickMessage` has one signature used in one place.
- **Constraint check:** both new/changed tools are `mutates: false` on `watchlist:read`; `symbol.search` has no underscore; every new failure path degrades rather than throwing; the backfill is double-gated and single-attempt; the picker imports the tool module with `import type` only; the prompt bumps 3 → 4 with a new golden hash and keeps the Art 50 substrings and dependency-free rule intact.

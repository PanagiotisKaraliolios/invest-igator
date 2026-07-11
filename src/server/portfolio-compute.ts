import { Prisma } from '@prisma/generated';
import { env } from '@/env';
import type { Currency } from '@/lib/currency';
import { toLocalIsoDate } from '@/lib/date';
import { isValidSymbol, normalizeSymbol } from '@/lib/validation';
import { db } from '@/server/db';
import { convertAmount, type FxMatrix, forwardFill, MissingFxRateError } from '@/server/fx';
import { buildFxByDate, getFxMatrix } from '@/server/fx-history';
import { fluxStringLiteral, influxQueryApi, measurement } from '@/server/influx';

/**
 * Portfolio computation core + server-side caching.
 *
 * The expensive inception-to-date NAV/TWR/MWR series and the current-value
 * structure are pure functions of (userId, currency, today). They are cached in a
 * shared Postgres table (`PortfolioCache`) keyed on those inputs, so every
 * /portfolio and /portfolio/returns view is served from one store that ALL app
 * instances read consistently (multi-instance safe, read-your-writes) — no Redis.
 * `invalidatePortfolioCache` is called from the mutations that change the inputs
 * (transactions) so edits appear immediately across every instance.
 */

const CACHE_TTL_MS = 60 * 60 * 1000; // freshness backstop (intraday ingest); mutations invalidate explicitly

/**
 * Bump whenever the shape of a cached payload (`FullSeries` / `StructureResult`) changes.
 * The version is part of the row key, so a deploy with a new shape misses every stale row
 * instead of deserializing it as the new type for up to CACHE_TTL_MS.
 */
const PAYLOAD_VERSION = 'v1';

/**
 * Read a cached payload if present and fresh; otherwise compute, persist, and return.
 * Purely additive: a cache read/write failure degrades to an uncached compute rather
 * than surfacing a new error.
 */
async function cached<T>(
	userId: string,
	currency: Currency,
	day: string,
	kind: string,
	compute: () => Promise<T>
): Promise<T> {
	const where = { userId_currency_day_kind: { currency, day, kind, userId } };
	try {
		const row = await db.portfolioCache.findUnique({ where });
		if (row && Date.now() - row.computedAt.getTime() < CACHE_TTL_MS) {
			return row.payload as unknown as T;
		}
	} catch (e) {
		// Never fail a request because the cache is unreadable — recompute. But log it:
		// a persistent read failure is an invisible perf cliff otherwise.
		console.error('[portfolio-cache] read failed', e);
	}
	const result = await compute();
	try {
		const payload = result as unknown as Prisma.InputJsonValue;
		const computedAt = new Date();
		await db.portfolioCache.upsert({
			create: { computedAt, currency, day, kind, payload, userId },
			update: { computedAt, payload },
			where
		});
		// Bound growth: nothing else prunes this table. Drop this user's rows that can no
		// longer be served — older than the TTL, or written under a previous PAYLOAD_VERSION.
		await db.portfolioCache.deleteMany({
			where: { computedAt: { lt: new Date(computedAt.getTime() - CACHE_TTL_MS) }, userId }
		});
	} catch (e) {
		// Persisting is best-effort. Two instances racing the same key hit a unique
		// violation (P2002) — benign. Anything else is real and must not stay silent.
		if ((e as { code?: unknown } | null)?.code !== 'P2002') {
			console.error('[portfolio-cache] write failed', e);
		}
	}
	return result;
}

type PerfTx = {
	date: Date | null;
	fee: number | null;
	feeCurrency: string | null;
	price: number;
	priceCurrency: string | null;
	quantity: number;
	side: string;
	symbol: string;
};

export type FullSeriesPoint = { date: string; nav: number; twrIndex: number; mwrIndex: number };

export type FullSeries = { full: FullSeriesPoint[]; unconvertedSymbols: string[] };

const PORTFOLIO_TX_SELECT = {
	date: true,
	fee: true,
	feeCurrency: true,
	price: true,
	priceCurrency: true,
	quantity: true,
	side: true,
	symbol: true
} as const;

/**
 * Fetches the latest closing prices for an array of symbols from InfluxDB.
 * @internal
 */
export async function getLatestCloses(symbols: string[]): Promise<Record<string, number | null>> {
	const normalizedSymbols = symbols.map((sym) => normalizeSymbol(sym)).filter((sym) => isValidSymbol(sym));
	if (normalizedSymbols.length === 0) return {};
	const symbolFilter = normalizedSymbols.map((s) => `r.symbol == ${fluxStringLiteral(s)}`).join(' or ');

	const flux = `from(bucket: ${fluxStringLiteral(env.INFLUXDB_BUCKET)})
  |> range(start: -50y)
  |> filter(fn: (r) => r._measurement == ${fluxStringLiteral(measurement)} and (${symbolFilter}))
  |> filter(fn: (r) => r._field == ${fluxStringLiteral('close')})
  |> group(columns: ["symbol"])
  |> last()`;

	const out: Record<string, number | null> = Object.fromEntries(normalizedSymbols.map((s) => [s, null]));
	const rows = await influxQueryApi.collectRows<{ symbol: string; _value: number | string }>(flux);
	for (const r of rows) {
		const symbol = String(r.symbol);
		const val = typeof r._value === 'number' ? r._value : Number(r._value);
		if (!Number.isNaN(val)) out[symbol] = val;
	}
	return out;
}

/**
 * Pure inception-to-date NAV/TWR/MWR computation. No I/O — all data is passed in,
 * which makes it unit-testable and keeps the exact behavior of the original
 * inline day loop. Positions are currency-independent; each valuation and cash
 * flow converts at its own date via `fxByDate`.
 */
export function buildFullSeries(params: {
	txs: PerfTx[];
	inceptionDate: Date;
	toDate: Date;
	priceBySymbolDate: Map<string, Map<string, number>>;
	fxByDate: Map<string, FxMatrix>;
	symbolCurrencies: Map<string, string>;
	latestTxCurrencyBySymbol: Map<string, { currency: Currency; date: Date }>;
	target: Currency;
}): FullSeries {
	const {
		txs,
		inceptionDate,
		toDate,
		priceBySymbolDate,
		fxByDate,
		symbolCurrencies,
		latestTxCurrencyBySymbol,
		target
	} = params;
	const unconvertedSymbols = new Set<string>();
	// Most recent transaction price (in its own currency) per symbol, updated as the day
	// loop advances. Lets navOnDate value a position on days it has no market bar yet.
	const lastTxPriceBySymbol = new Map<string, { currency: Currency; price: number }>();

	// Helper: value of a position vector at a date.
	//
	// A held symbol with no market bar for the day — bought at/before its first listed
	// bar, or ingestion still pending — is valued at the price of its most recent
	// transaction so NAV stays consistent with the cash flow that acquired it. Without
	// this the position is absent from NAV while its purchase sits in `flow`, which
	// craters the daily return, then reappears as a spurious gain the day a bar arrives.
	function navOnDate(dateIso: string, qtyBySymbol: Map<string, number>): number {
		let total = 0;
		const fx: FxMatrix = fxByDate.get(dateIso) ?? {};
		for (const [sym, qty] of qtyBySymbol) {
			if (qty <= 0) continue;
			const marketPrice = priceBySymbolDate.get(sym)?.get(dateIso);
			let price: number;
			let currency: string;
			if (marketPrice) {
				price = marketPrice;
				currency = symbolCurrencies.get(sym) ?? latestTxCurrencyBySymbol.get(sym)?.currency ?? 'USD';
			} else {
				// No usable market price. Fall back to the price we last transacted at (its
				// currency), which is exactly what `flow` was booked at — keeping NAV and the
				// cash flow on the same basis. qty > 0 implies a prior buy, so `cost` exists;
				// the guard is defensive.
				const cost = lastTxPriceBySymbol.get(sym);
				if (!cost) continue;
				price = cost.price;
				currency = cost.currency;
			}
			try {
				total += qty * convertAmount(price, currency, target, fx);
			} catch (e) {
				if (e instanceof MissingFxRateError) {
					unconvertedSymbols.add(sym);
				} else {
					throw e;
				}
			}
		}
		return total;
	}

	// Prepare date loop (inception -> to)
	const datesFull: string[] = [];
	for (let d = new Date(inceptionDate); d <= toDate; d.setDate(d.getDate() + 1)) {
		datesFull.push(toLocalIsoDate(d));
	}

	// State across days
	const qtyBySymbol = new Map<string, number>();
	let prevNav = 0;
	let twrIndex = 100; // chain-linked index
	let mwrIndex = 100;

	// Group transactions by day
	const txByDay = new Map<string, PerfTx[]>();
	for (const t of txs) {
		const day = t.date ? toLocalIsoDate(new Date(t.date)) : undefined;
		if (!day) continue;
		if (!txByDay.has(day)) txByDay.set(day, []);
		txByDay.get(day)!.push(t);
	}

	// Compute over full history, then (caller) filters for selected range
	const full: FullSeriesPoint[] = [];

	for (const day of datesFull) {
		// Apply transactions up to and including this day to update quantities
		const dayTx = txByDay.get(day) ?? [];
		// Compute external cash flow in target currency for the day
		let flow = 0;
		for (const t of dayTx) {
			const up = normalizeSymbol(t.symbol);
			if (!isValidSymbol(up)) continue;
			const sign = t.side === 'BUY' ? 1 : -1;
			const transactionValue = t.quantity * t.price; // in priceCurrency
			const transactionCurrency = (t.priceCurrency as Currency) ?? 'USD';
			// Update positions first (buys increase qty, sells decrease). Position
			// accounting is currency-independent, so it must happen regardless of FX.
			const prevQty = qtyBySymbol.get(up) ?? 0;
			qtyBySymbol.set(up, prevQty + (sign === 1 ? t.quantity : -t.quantity));
			// Remember this transaction's price so navOnDate can value the position on days
			// it has no market bar yet (keeps NAV consistent with this cash flow). The flow
			// itself is always booked — it never needed a market price, only an FX rate.
			lastTxPriceBySymbol.set(up, { currency: transactionCurrency, price: t.price });
			// Convert the cash flow to target currency. On a missing FX rate, flag the
			// symbol and skip this flow's contribution (treat as 0) rather than crashing.
			try {
				const txFx: FxMatrix = fxByDate.get(day) ?? {};
				const valueInTarget = convertAmount(transactionValue, transactionCurrency, target, txFx);
				let feeInTarget = 0;
				if (t.fee) {
					const feeCurrency = (t.feeCurrency as string) ?? transactionCurrency;
					feeInTarget = convertAmount(t.fee, feeCurrency, target, txFx);
				}
				// External flow from investor to portfolio (positive = contribution, negative = withdrawal)
				const flowForTx = sign === 1 ? valueInTarget + feeInTarget : -(valueInTarget - feeInTarget);
				flow += flowForTx;
			} catch (e) {
				if (e instanceof MissingFxRateError) unconvertedSymbols.add(up);
				else throw e;
			}
		}

		const nav = navOnDate(day, qtyBySymbol);
		if (full.length === 0) {
			// Initialize indices at first day; yield 0
			full.push({ date: day, mwrIndex: 100, nav, twrIndex: 100 });
			prevNav = nav;
			continue;
		}

		// Daily returns
		const safePrevNav = Math.abs(prevNav) > 1e-8 ? prevNav : 1; // guard tiny/zero
		const rTwr = (nav - prevNav - flow) / safePrevNav;
		const denomMwr = prevNav + 0.5 * flow; // modified Dietz with mid-day weighting
		const rMwr = denomMwr !== 0 ? (nav - prevNav - flow) / denomMwr : 0;

		twrIndex *= 1 + (Number.isFinite(rTwr) ? rTwr : 0);
		mwrIndex *= 1 + (Number.isFinite(rMwr) ? rMwr : 0);

		full.push({ date: day, mwrIndex, nav, twrIndex });
		prevNav = nav;
	}

	return { full, unconvertedSymbols: Array.from(unconvertedSymbols) };
}

/**
 * I/O wrapper: loads transactions + prices + FX for a user and runs the pure
 * `buildFullSeries`. The series always spans inception -> `todayIso`; callers
 * slice/normalize to their requested range. Independent I/O runs in parallel.
 */
export async function computeFullSeries(userId: string, target: Currency, todayIso: string): Promise<FullSeries> {
	const toDate = new Date(`${todayIso}T00:00:00Z`);
	if (Number.isNaN(toDate.getTime())) throw new Error('Invalid date');

	// Fetch transactions in range (and earlier to establish positions)
	const txs = await db.transaction.findMany({
		select: PORTFOLIO_TX_SELECT,
		where: { date: { lte: toDate }, userId }
	});

	const symbols = Array.from(new Set(txs.map((t) => normalizeSymbol(t.symbol)).filter((sym) => isValidSymbol(sym))));

	let inceptionDate: Date | null = null;
	for (const t of txs) {
		if (!t.date) continue;
		if (inceptionDate === null || t.date < inceptionDate) inceptionDate = t.date;
	}
	if (!inceptionDate) return { full: [], unconvertedSymbols: [] };

	// Latest transaction currency per symbol (sync; derived from txs)
	const latestTxCurrencyBySymbol = new Map<string, { currency: Currency; date: Date }>();
	for (const t of txs) {
		const up = normalizeSymbol(t.symbol);
		if (!isValidSymbol(up)) continue;
		const transactionCurrency = (t.priceCurrency as Currency) ?? 'USD';
		if (t.date) {
			const prevCur = latestTxCurrencyBySymbol.get(up);
			if (!prevCur || t.date > prevCur.date)
				latestTxCurrencyBySymbol.set(up, { currency: transactionCurrency, date: t.date });
		}
	}

	// Independent I/O in parallel: historical closes, per-date FX, listing currencies.
	const seedStart = new Date(inceptionDate);
	seedStart.setDate(seedStart.getDate() - 7); // 1 week back to find latest prior close
	const stopDate = new Date(toDate);
	stopDate.setDate(stopDate.getDate() + 1); // inclusive end safeguard

	const priceRowsPromise =
		symbols.length > 0
			? (() => {
					const symbolFilter = symbols.map((s) => `r.symbol == ${fluxStringLiteral(s)}`).join(' or ');
					const flux = `from(bucket: ${fluxStringLiteral(env.INFLUXDB_BUCKET)})
	|> range(start: ${seedStart.toISOString()}, stop: ${stopDate.toISOString()})
	|> filter(fn: (r) => r._measurement == ${fluxStringLiteral(measurement)} and (${symbolFilter}))
	|> filter(fn: (r) => r._field == ${fluxStringLiteral('close')})
	|> group(columns: ["symbol"])`;
					return influxQueryApi.collectRows<{ symbol: string; _value: number | string; _time: string }>(flux);
				})()
			: Promise.resolve([] as { symbol: string; _value: number | string; _time: string }[]);

	const [rows, fxByDate, wlItems] = await Promise.all([
		priceRowsPromise,
		buildFxByDate(toLocalIsoDate(inceptionDate), toLocalIsoDate(toDate)),
		db.watchlistItem.findMany({
			select: { currency: true, symbol: true },
			where: { symbol: { in: Array.from(latestTxCurrencyBySymbol.keys()) }, userId }
		})
	]);

	// Build price map with carry-forward per day (inception -> to).
	const priceBySymbolDate = new Map<string, Map<string, number>>();
	if (symbols.length > 0) {
		const raw = new Map<string, Map<string, number>>();
		for (const r of rows) {
			const s = normalizeSymbol(String(r.symbol));
			if (!isValidSymbol(s)) continue;
			const day = String(r._time).slice(0, 10);
			const v = typeof r._value === 'number' ? r._value : Number(r._value);
			if (!Number.isFinite(v)) continue;
			if (!raw.has(s)) raw.set(s, new Map());
			raw.get(s)!.set(day, v);
		}

		const dateKeys: string[] = [];
		for (let d = new Date(inceptionDate); d <= toDate; d.setDate(d.getDate() + 1)) {
			dateKeys.push(toLocalIsoDate(d));
		}

		// Forward-fill each symbol across inception..to, seeded by its latest close strictly
		// before inception (same helper as the FX carry-forward). Seeding at inception — rather
		// than at a caller-supplied `from` — is deliberate: it makes the inception-to-date totals
		// independent of the requested chart window and lets one cached series serve every range.
		for (const s of symbols) {
			const up = normalizeSymbol(s);
			priceBySymbolDate.set(up, forwardFill(raw.get(up) ?? new Map<string, number>(), dateKeys));
		}
	}

	const symbolCurrencies = new Map<string, string>();
	for (const it of wlItems) {
		const n = normalizeSymbol(it.symbol);
		if (isValidSymbol(n)) symbolCurrencies.set(n, it.currency);
	}

	return buildFullSeries({
		fxByDate,
		inceptionDate,
		latestTxCurrencyBySymbol,
		priceBySymbolDate,
		symbolCurrencies,
		target,
		toDate,
		txs
	});
}

/** Cached inception-to-date series. One entry per (user, currency, day). */
export function getCachedFullSeries(userId: string, target: Currency, todayIso: string): Promise<FullSeries> {
	return cached(userId, target, todayIso, `full:${PAYLOAD_VERSION}`, () =>
		computeFullSeries(userId, target, todayIso)
	);
}

export type StructureItem = {
	avgCost: number;
	price: number;
	quantity: number;
	symbol: string;
	totalCost: number;
	unconverted: boolean;
	value: number;
	weight: number;
};

export type StructureResult = { items: StructureItem[]; totalValue: number };

/**
 * Current-value structure: cost basis converts at each transaction's date, current
 * market value at the latest FX. Independent I/O runs in parallel.
 */
export async function computeStructure(userId: string, target: Currency, todayIso: string): Promise<StructureResult> {
	const txs = await db.transaction.findMany({ select: PORTFOLIO_TX_SELECT, where: { userId } });

	let minTxDate: Date | null = null;
	for (const t of txs) {
		if (t.date && (!minTxDate || t.date < minTxDate)) minTxDate = t.date;
	}
	const [fxByDate, fxLatest] = await Promise.all([
		buildFxByDate(minTxDate ? toLocalIsoDate(minTxDate) : todayIso, todayIso),
		getFxMatrix()
	]);

	const bySymbol = new Map<string, { symbol: string; quantity: number; totalCostInTarget: number }>();
	const latestTxCurrencyBySymbol = new Map<string, { currency: Currency; date: Date }>();
	const costUnconverted = new Set<string>();
	for (const t of txs) {
		const up = normalizeSymbol(t.symbol);
		if (!isValidSymbol(up)) continue;
		const sign = t.side === 'BUY' ? 1 : -1;
		const prev = bySymbol.get(up) ?? { quantity: 0, symbol: up, totalCostInTarget: 0 };

		const transactionValue = t.quantity * t.price;
		const transactionCurrency = (t.priceCurrency as Currency) ?? 'USD';

		let costAdjustment = 0;
		try {
			const txFx: FxMatrix = t.date ? (fxByDate.get(toLocalIsoDate(new Date(t.date))) ?? {}) : fxLatest;
			const valueInTarget = convertAmount(transactionValue, transactionCurrency, target, txFx);
			let feeInTarget = 0;
			if (t.fee) {
				const feeCurrency = (t.feeCurrency as string) ?? transactionCurrency;
				feeInTarget = convertAmount(t.fee, feeCurrency, target, txFx);
			}
			costAdjustment = sign === 1 ? valueInTarget + feeInTarget : -(valueInTarget - feeInTarget);
		} catch (e) {
			if (e instanceof MissingFxRateError) costUnconverted.add(up);
			else throw e;
		}

		bySymbol.set(up, {
			quantity: prev.quantity + sign * t.quantity,
			symbol: up,
			totalCostInTarget: prev.totalCostInTarget + costAdjustment
		});

		if (t.date) {
			const prevCur = latestTxCurrencyBySymbol.get(up);
			if (!prevCur || t.date > prevCur.date)
				latestTxCurrencyBySymbol.set(up, { currency: transactionCurrency, date: t.date });
		}
	}

	const holdings = Array.from(bySymbol.values()).filter((h) => h.quantity > 0);
	const symbols = holdings.map((h) => h.symbol);

	const [watchlistItems, latest] = await Promise.all([
		db.watchlistItem.findMany({
			select: { currency: true, symbol: true },
			where: { symbol: { in: symbols }, userId }
		}),
		getLatestCloses(symbols)
	]);

	const symbolCurrencies = new Map<string, string>();
	for (const item of watchlistItems) {
		const normalized = normalizeSymbol(item.symbol);
		if (!isValidSymbol(normalized)) continue;
		symbolCurrencies.set(normalized, item.currency);
	}

	const items = holdings
		.map((h) => {
			const price = latest[h.symbol] ?? 0;
			const marketCurrency =
				symbolCurrencies.get(h.symbol) ?? latestTxCurrencyBySymbol.get(h.symbol)?.currency ?? 'USD';
			let priceInTarget = price;
			let unconverted = costUnconverted.has(h.symbol);
			try {
				priceInTarget = convertAmount(price, marketCurrency, target, fxLatest);
			} catch (e) {
				if (e instanceof MissingFxRateError) {
					unconverted = true;
				} else {
					throw e;
				}
			}
			const currentValue = unconverted ? 0 : h.quantity * priceInTarget;
			return {
				avgCost: h.quantity > 0 ? h.totalCostInTarget / h.quantity : 0,
				price: unconverted ? price : priceInTarget,
				quantity: h.quantity,
				symbol: h.symbol,
				totalCost: h.totalCostInTarget,
				unconverted,
				value: currentValue
			};
		})
		.filter((i) => i.value > 0 || i.unconverted);

	const totalValue = items.reduce((acc, i) => acc + i.value, 0);
	const withWeights = items
		.map((i) => ({ ...i, weight: totalValue > 0 ? i.value / totalValue : 0 }))
		.sort((a, b) => b.value - a.value);

	return { items: withWeights, totalValue };
}

/** Cached current structure. One entry per (user, currency, day). */
export function getCachedStructure(userId: string, target: Currency, todayIso: string): Promise<StructureResult> {
	return cached(userId, target, todayIso, `structure:${PAYLOAD_VERSION}`, () =>
		computeStructure(userId, target, todayIso)
	);
}

/** Invalidate a user's cached portfolio computations after a mutation (await to guarantee read-your-writes). */
export async function invalidatePortfolioCache(userId: string): Promise<void> {
	await db.portfolioCache.deleteMany({ where: { userId } });
}

/**
 * Clear ALL users' cached portfolio computations. Used when a global input changes
 * for many users at once (e.g. an admin correcting a symbol's listing currency).
 */
export async function invalidateAllPortfolioCache(): Promise<void> {
	await db.portfolioCache.deleteMany({});
}

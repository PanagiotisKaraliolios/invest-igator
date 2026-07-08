import { env } from '@/env';
import type { Currency } from '@/lib/currency';
import { toLocalIsoDate } from '@/lib/date';
import { isValidSymbol, normalizeSymbol } from '@/lib/validation';
import { db } from '@/server/db';
import { convertAmount, type FxMatrix, MissingFxRateError } from '@/server/fx';
import { buildFxByDate, getFxMatrix } from '@/server/fx-history';
import { fluxStringLiteral, influxQueryApi, measurement } from '@/server/influx';

/**
 * Portfolio computation core + server-side caching.
 *
 * The expensive inception-to-date NAV/TWR/MWR series and the current-value
 * structure are pure functions of (userId, currency, today). They are cached in a
 * process-local TTL memo (single-container deployment — no Redis, and no
 * dependency on Next's in-flux cache-tag API) keyed on those inputs, so every
 * /portfolio and /portfolio/returns view is served from memory and shares one
 * entry. `invalidatePortfolioCache` is called from the mutations that change the
 * inputs (transactions, watchlist) so edits appear immediately.
 */

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h backstop; mutations invalidate explicitly

type CacheEntry<T> = { expiresAt: number; promise: Promise<T> };
// key: `${userId}::${kind}::${currency}::${todayIso}` — userId first so a user's
// entries can be cleared by prefix on mutation. userId is a cuid (no "::").
const portfolioCache = new Map<string, CacheEntry<unknown>>();

function memoized<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const now = Date.now();
	const existing = portfolioCache.get(key) as CacheEntry<T> | undefined;
	if (existing && existing.expiresAt > now) return existing.promise;
	// Prune expired entries opportunistically to keep the map bounded.
	for (const [k, v] of portfolioCache) if (v.expiresAt <= now) portfolioCache.delete(k);
	const entry: CacheEntry<T> = { expiresAt: now + CACHE_TTL_MS, promise: Promise.resolve() as Promise<T> };
	entry.promise = fn().catch((e: unknown) => {
		// Never cache a failure.
		if (portfolioCache.get(key) === (entry as CacheEntry<unknown>)) portfolioCache.delete(key);
		throw e;
	});
	portfolioCache.set(key, entry as CacheEntry<unknown>);
	return entry.promise;
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

	// Helper: value of a position vector at a date
	function navOnDate(dateIso: string, qtyBySymbol: Map<string, number>): number {
		let total = 0;
		const fx: FxMatrix = fxByDate.get(dateIso) ?? {};
		for (const [sym, qty] of qtyBySymbol) {
			const p = priceBySymbolDate.get(sym)?.get(dateIso);
			if (!p || qty <= 0) continue;
			const marketCurrency = symbolCurrencies.get(sym) ?? latestTxCurrencyBySymbol.get(sym)?.currency ?? 'USD';
			try {
				total += qty * convertAmount(p, marketCurrency, target, fx);
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

		// Seed each symbol with its latest close before inception, then forward-fill.
		// (Positions are zero before their first buy at inception, so the pre-inception
		// seed only matters if a price is missing exactly at inception.)
		const isoInceptionKey = toLocalIsoDate(inceptionDate);
		for (const s of symbols) {
			const up = normalizeSymbol(s);
			const src = raw.get(up) ?? new Map<string, number>();
			let seedVal: number | undefined;
			for (const [iso, val] of Array.from(src.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
				if (iso < isoInceptionKey) seedVal = val;
			}
			const filled = new Map<string, number>();
			let last = seedVal;
			for (const iso of dateKeys) {
				const v = src.get(iso);
				if (v != null && Number.isFinite(v)) last = v;
				if (last != null && Number.isFinite(last)) filled.set(iso, last);
			}
			priceBySymbolDate.set(up, filled);
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
	return memoized(`${userId}::full::${target}::${todayIso}`, () => computeFullSeries(userId, target, todayIso));
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
	return memoized(`${userId}::struct::${target}::${todayIso}`, () => computeStructure(userId, target, todayIso));
}

/** Invalidate a user's cached portfolio computations after a mutation. */
export function invalidatePortfolioCache(userId: string): void {
	const prefix = `${userId}::`;
	for (const key of portfolioCache.keys()) {
		if (key.startsWith(prefix)) portfolioCache.delete(key);
	}
}

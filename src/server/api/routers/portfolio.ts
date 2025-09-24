import type { Currency } from '@prisma/client';
import { z } from 'zod';
import { env } from '@/env';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { convertAmount, getFxMatrix } from '@/server/fx';
import { influxQueryApi, measurement } from '@/server/influx';

type Holding = {
	symbol: string;
	quantity: number;
};

async function getLatestCloses(symbols: string[]): Promise<Record<string, number | null>> {
	if (symbols.length === 0) return {};
	// Build a single Flux query to fetch the latest close per symbol
	const symbolFilter = symbols.map((s) => `r.symbol == "${s.replaceAll('"', '\\"')}"`).join(' or ');

	const flux = `from(bucket: "${env.INFLUXDB_BUCKET}")
  |> range(start: -50y)
  |> filter(fn: (r) => r._measurement == "${measurement}" and (${symbolFilter}))
  |> filter(fn: (r) => r._field == "close")
  |> group(columns: ["symbol"])
  |> last()`;

	const out: Record<string, number | null> = Object.fromEntries(symbols.map((s) => [s, null]));
	const rows = await influxQueryApi.collectRows<{ symbol: string; _value: number | string }>(flux);
	for (const r of rows) {
		const symbol = String(r.symbol);
		const val = typeof r._value === 'number' ? r._value : Number(r._value);
		if (!Number.isNaN(val)) out[symbol] = val;
	}
	return out;
}

export const portfolioRouter = createTRPCRouter({
	performance: protectedProcedure
		.input(
			z.object({
				currency: z.enum(['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB']).default('USD'),
				from: z.string(), // ISO yyyy-mm-dd
				to: z.string() // ISO yyyy-mm-dd
			})
		)
		.query(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const target: Currency = input.currency as Currency;

			const fromDate = new Date(input.from + 'T00:00:00Z');
			const toDate = new Date(input.to + 'T00:00:00Z');
			if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
				throw new Error('Invalid date range');
			}

			// Fetch transactions in range (and earlier to establish positions)
			const txs = await ctx.db.transaction.findMany({
				select: {
					date: true,
					fee: true,
					feeCurrency: true,
					price: true,
					priceCurrency: true,
					quantity: true,
					side: true,
					symbol: true
				},
				where: { date: { lte: toDate }, userId }
			});

			// Collect symbols involved
			const symbols = Array.from(new Set(txs.map((t) => t.symbol.trim().toUpperCase())));

			// Determine inception date based on first transaction
			let inceptionDate: Date | null = null;
			for (const t of txs) {
				if (!t.date) continue;
				if (inceptionDate === null || t.date < inceptionDate) inceptionDate = t.date;
			}
			if (!inceptionDate) {
				return {
					points: [],
					prevDayReturnMwr: 0,
					prevDayReturnTwr: 0,
					totalReturnMwr: 0,
					totalReturnTwr: 0
				} as const;
			}

			// Build price map from Influx for date range with carry-forward per day.
			let priceBySymbolDate = new Map<string, Map<string, number>>();
			if (symbols.length > 0) {
				const symbolFilter = symbols.map((s) => `r.symbol == "${s.replaceAll('"', '\\"')}"`).join(' or ');
				// Query historical closes including a seed window before range to seed carry-forward
				const seedStart = new Date(inceptionDate);
				seedStart.setDate(seedStart.getDate() - 7); // 1 week back to find latest prior close
				const stopDate = new Date(toDate);
				stopDate.setDate(stopDate.getDate() + 1); // inclusive end safeguard
				const flux = `from(bucket: "${env.INFLUXDB_BUCKET}")
	|> range(start: ${seedStart.toISOString()}, stop: ${stopDate.toISOString()})
	|> filter(fn: (r) => r._measurement == "${measurement}" and (${symbolFilter}))
	|> filter(fn: (r) => r._field == "close")
	|> group(columns: ["symbol"])`;
				const rows = await influxQueryApi.collectRows<{
					symbol: string;
					_value: number | string;
					_time: string;
				}>(flux);
				// Raw map of symbol -> iso -> close
				const raw = new Map<string, Map<string, number>>();
				for (const r of rows) {
					const s = String(r.symbol).trim().toUpperCase();
					const day = String(r._time).slice(0, 10);
					const v = typeof r._value === 'number' ? r._value : Number(r._value);
					if (!Number.isFinite(v)) continue;
					if (!raw.has(s)) raw.set(s, new Map());
					raw.get(s)!.set(day, v);
				}

				// Prepare continuous date list for filling (inception -> to)
				const toIsoKey = (d: Date) =>
					`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
				const dateKeys: string[] = [];
				for (let d = new Date(inceptionDate); d <= toDate; d.setDate(d.getDate() + 1)) {
					dateKeys.push(toIsoKey(d));
				}

				// For each symbol: seed with last known close before fromDate, then forward-fill across range
				priceBySymbolDate = new Map();
				for (const s of symbols) {
					const up = s.trim().toUpperCase();
					const src = raw.get(up) ?? new Map<string, number>();
					// find seed: latest date < from in src
					const isoFromKey = toIsoKey(fromDate);
					let seedVal: number | undefined;
					for (const [iso, val] of Array.from(src.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
						if (iso < isoFromKey) {
							seedVal = val;
						}
					}
					const filled = new Map<string, number>();
					let last = seedVal;
					for (const iso of dateKeys) {
						const v = src.get(iso);
						if (v != null && Number.isFinite(v)) {
							last = v;
						}
						if (last != null && Number.isFinite(last)) {
							filled.set(iso, last);
						}
					}
					priceBySymbolDate.set(up, filled);
				}
			}

			// Get FX for conversion to target currency (current snapshot)
			const fx = await getFxMatrix();

			// Helper: value of a position vector at a date
			function navOnDate(dateIso: string, qtyBySymbol: Map<string, number>): number {
				let total = 0;
				for (const [sym, qty] of qtyBySymbol) {
					const p = priceBySymbolDate.get(sym)?.get(dateIso);
					if (!p || qty <= 0) continue;
					// Determine security currency from latest tx for that symbol, fallback USD
					const latestTx = latestTxCurrencyBySymbol.get(sym)?.currency ?? 'USD';
					const priceInTarget = convertAmount(p, latestTx, target, fx);
					total += qty * priceInTarget;
				}
				return total;
			}

			// Track latest transaction currency per symbol for valuation conversion
			const latestTxCurrencyBySymbol = new Map<string, { currency: Currency; date: Date }>();
			for (const t of txs) {
				const up = t.symbol.trim().toUpperCase();
				const transactionCurrency = (t.priceCurrency as Currency) ?? 'USD';
				if (t.date) {
					const prevCur = latestTxCurrencyBySymbol.get(up);
					if (!prevCur || t.date > prevCur.date)
						latestTxCurrencyBySymbol.set(up, { currency: transactionCurrency, date: t.date });
				}
			}

			// Prepare date loop (inception -> to)
			function toIso(d: Date) {
				return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
			}
			const datesFull: string[] = [];
			for (let d = new Date(inceptionDate); d <= toDate; d.setDate(d.getDate() + 1)) {
				datesFull.push(toIso(d));
			}

			// State across days
			const qtyBySymbol = new Map<string, number>();
			let prevNav = 0;
			let twrIndex = 100; // chain-linked index
			let mwrIndex = 100;

			// Group transactions by day
			const txByDay = new Map<string, typeof txs>();
			for (const t of txs) {
				const day = t.date ? toIso(new Date(t.date)) : undefined;
				if (!day) continue;
				if (!txByDay.has(day)) txByDay.set(day, [] as any);
				txByDay.get(day)!.push(t);
			}

			// Compute over full history, then filter for selected range
			const full: { date: string; nav: number; twrIndex: number; mwrIndex: number }[] = [];

			for (const day of datesFull) {
				// Apply transactions up to and including this day to update quantities
				const dayTx = txByDay.get(day) ?? [];
				// Compute external cash flow in target currency for the day (negative for contributions/buys)
				let flow = 0;
				for (const t of dayTx) {
					const up = t.symbol.trim().toUpperCase();
					const sign = t.side === 'BUY' ? 1 : -1;
					const transactionValue = t.quantity * t.price; // in priceCurrency
					const transactionCurrency = (t.priceCurrency as Currency) ?? 'USD';
					const valueInTarget = convertAmount(transactionValue, transactionCurrency, target, fx);
					let feeInTarget = 0;
					if (t.fee) {
						const feeCurrency = (t.feeCurrency as Currency) ?? transactionCurrency;
						feeInTarget = convertAmount(t.fee, feeCurrency, target, fx);
					}
					// Update positions first (buys increase qty, sells decrease)
					const prevQty = qtyBySymbol.get(up) ?? 0;
					qtyBySymbol.set(up, prevQty + (sign === 1 ? t.quantity : -t.quantity));
					// External flow from investor to portfolio (positive = contribution, negative = withdrawal)
					// BUY: you contribute cash to acquire assets; SELL: you withdraw cash from the portfolio
					const flowForTx = sign === 1 ? valueInTarget + feeInTarget : -(valueInTarget - feeInTarget);
					flow += flowForTx;
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

			if (full.length === 0) {
				return {
					points: [],
					prevDayReturnMwr: 0,
					prevDayReturnTwr: 0,
					totalReturnMwr: 0,
					totalReturnTwr: 0
				} as const;
			}

			// Prepare chart points for selected range relative to the first point within that range
			const startIdx = full.findIndex((p) => p.date >= toIso(fromDate));
			const chartSlice = startIdx >= 0 ? full.slice(startIdx) : [];
			const baseTwr = chartSlice[0]?.twrIndex ?? 100;
			const baseMwr = chartSlice[0]?.mwrIndex ?? 100;
			const points = chartSlice.map((p) => ({
				date: p.date,
				netAssets: p.nav,
				yieldMwr: (p.mwrIndex / baseMwr - 1) * 100,
				yieldTwr: (p.twrIndex / baseTwr - 1) * 100
			}));

			// Inception-to-date totals
			const lastFull = full[full.length - 1]!;
			const prevFull = full.length > 1 ? full[full.length - 2]! : undefined;
			const totalReturnTwr = lastFull.twrIndex - 100;
			const totalReturnMwr = lastFull.mwrIndex - 100;
			const prevDayReturnTwr = prevFull ? (lastFull.twrIndex / prevFull.twrIndex - 1) * 100 : 0;
			const prevDayReturnMwr = prevFull ? (lastFull.mwrIndex / prevFull.mwrIndex - 1) * 100 : 0;

			const res = { points, prevDayReturnMwr, prevDayReturnTwr, totalReturnMwr, totalReturnTwr } as const;
			return res;
		}),
	structure: protectedProcedure
		.input(
			z.object({
				currency: z.enum(['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB']).default('USD')
			})
		)
		.query(async ({ ctx, input }) => {
			const target: Currency = input.currency as Currency;
			const userId = ctx.session.user.id;
			const txs = await ctx.db.transaction.findMany({
				select: {
					date: true,
					fee: true,
					feeCurrency: true,
					price: true,
					priceCurrency: true,
					quantity: true,
					side: true,
					symbol: true
				},
				where: { userId }
			});

			// Get FX matrix for conversions
			const fx = await getFxMatrix();

			const bySymbol = new Map<string, { symbol: string; quantity: number; totalCostInTarget: number }>();
			const latestTxCurrencyBySymbol = new Map<string, { currency: Currency; date: Date }>();
			for (const t of txs) {
				const up = t.symbol.trim().toUpperCase();
				const sign = t.side === 'BUY' ? 1 : -1;
				const prev = bySymbol.get(up) ?? { quantity: 0, symbol: up, totalCostInTarget: 0 };

				// Convert transaction value to target currency
				const transactionValue = t.quantity * t.price;
				const transactionCurrency = (t.priceCurrency as Currency) ?? 'USD';
				const valueInTarget = convertAmount(transactionValue, transactionCurrency, target, fx);

				// Convert fee to target currency if it exists
				let feeInTarget = 0;
				if (t.fee) {
					const feeCurrency = (t.feeCurrency as Currency) ?? transactionCurrency;
					feeInTarget = convertAmount(t.fee, feeCurrency, target, fx);
				}

				// For buys: add cost, for sells: subtract proceeds
				const costAdjustment = sign === 1 ? valueInTarget + feeInTarget : -(valueInTarget - feeInTarget);

				bySymbol.set(up, {
					quantity: prev.quantity + sign * t.quantity,
					symbol: up,
					totalCostInTarget: prev.totalCostInTarget + costAdjustment
				});

				// Track latest transaction currency per symbol for fallback pricing currency
				if (t.date) {
					const prevCur = latestTxCurrencyBySymbol.get(up);
					if (!prevCur || t.date > prevCur.date) {
						latestTxCurrencyBySymbol.set(up, { currency: transactionCurrency, date: t.date });
					}
				}
			}

			// Keep only positive quantities (long holdings). Ignore zero/negative for now.
			const holdings = Array.from(bySymbol.values()).filter((h) => h.quantity > 0);

			console.log('🚀 ~ portfolio.ts:355 ~ holdings:', holdings);

			const symbols = holdings.map((h) => h.symbol);

			// Get watchlist items to know the trading currency of each symbol
			const watchlistItems = await ctx.db.watchlistItem.findMany({
				select: {
					currency: true,
					symbol: true
				},
				where: {
					symbol: { in: symbols },
					userId
				}
			});

			const symbolCurrencies = new Map<string, Currency>();

			for (const item of watchlistItems) {
				symbolCurrencies.set(item.symbol.trim().toUpperCase(), item.currency);
			}

			const latest = await getLatestCloses(symbols);

			// Market prices are in the currency specified by the watchlist item,
			// or fall back to the latest transaction currency for the symbol, else USD.
			const items = holdings
				.map((h) => {
					const price = latest[h.symbol] ?? 0;
					const marketCurrency =
						symbolCurrencies.get(h.symbol) ?? latestTxCurrencyBySymbol.get(h.symbol)?.currency ?? 'USD';
					const priceInTarget = convertAmount(price, marketCurrency, target, fx);
					const currentValue = h.quantity * priceInTarget;
					return {
						avgCost: h.quantity > 0 ? h.totalCostInTarget / h.quantity : 0,
						price: priceInTarget,
						quantity: h.quantity,
						symbol: h.symbol,
						totalCost: h.totalCostInTarget,
						value: currentValue
					};
				})
				.filter((i) => i.value > 0);

			const totalValue = items.reduce((acc, i) => acc + i.value, 0);
			const withWeights = items
				.map((i) => ({ ...i, weight: totalValue > 0 ? i.value / totalValue : 0 }))
				.sort((a, b) => b.value - a.value);

			console.log('🚀 ~ portfolio.ts:401 ~ withWeights:', withWeights);

			return { items: withWeights, totalValue } as const;
		})
});

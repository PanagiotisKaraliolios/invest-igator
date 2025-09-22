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

			return { items: withWeights, totalValue } as const;
		})
});

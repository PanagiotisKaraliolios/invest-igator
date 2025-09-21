import { z } from 'zod';
import { env } from '@/env';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
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
	structure: protectedProcedure.input(z.void()).query(async ({ ctx }) => {
		const userId = ctx.session.user.id;
		const txs = await ctx.db.transaction.findMany({
			select: { quantity: true, side: true, symbol: true },
			where: { userId }
		});

		const bySymbol = new Map<string, Holding>();
		for (const t of txs) {
			const up = t.symbol.trim().toUpperCase();
			const sign = t.side === 'BUY' ? 1 : -1;
			const prev = bySymbol.get(up)?.quantity ?? 0;
			bySymbol.set(up, { quantity: prev + sign * t.quantity, symbol: up });
		}

		// Keep only positive quantities (long holdings). Ignore zero/negative for now.
		const holdings = Array.from(bySymbol.values()).filter((h) => h.quantity > 0);
		const symbols = holdings.map((h) => h.symbol);
		const latest = await getLatestCloses(symbols);

		console.log('🚀 ~ portfolio.ts:58 ~ latest:', latest);

		const items = holdings
			.map((h) => {
				const price = latest[h.symbol] ?? 0;
				const value = h.quantity * (price ?? 0);
				return {
					price: price ?? 0,
					quantity: h.quantity,
					symbol: h.symbol,
					value
				};
			})
			.filter((i) => i.value > 0);

		console.log('🚀 ~ portfolio.ts:69 ~ items:', items);

		const totalValue = items.reduce((acc, i) => acc + i.value, 0);
		const withWeights = items
			.map((i) => ({ ...i, weight: totalValue > 0 ? i.value / totalValue : 0 }))
			.sort((a, b) => b.value - a.value);

		return { items: withWeights, totalValue } as const;
	})
});

import { z } from 'zod';
import { adminProcedure, createTRPCRouter } from '@/server/api/trpc';

export type AiOverview = {
	byModel: Array<{ calls: number; costNanoUsd: bigint; resolvedModel: string; totalTokens: number }>;
	latency: { p50: number | null; p95: number | null };
	outcomes: Array<{ count: number; outcome: string }>;
	tools: Array<{ calls: number; failures: number; toolName: string }>;
	totals: {
		calls: number;
		failureRate: number;
		platformNanoUsd: bigint;
		unpricedCalls: number;
		userNanoUsd: bigint;
	};
};

export const aiObservabilityRouter = createTRPCRouter({
	/**
	 * Spend (platform vs BYOK), latency p50/p95, failure rate by outcome, tool-call
	 * frequency, and cost by model.
	 *
	 * Costs are BigInt nanoUSD. `gpt-5.4-nano` input is $0.20/1M = 0.2 MICRO-USD per
	 * token; micro-USD integers truncate that to zero and silently under-bill.
	 * superjson serialises BigInt across tRPC, so these reach the client intact.
	 *
	 * Grouped by `resolvedModel`, NEVER by `modelId` — for Azure `modelId` is the
	 * deployment name and matches nothing in the price catalogue.
	 */
	overview: adminProcedure
		.input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
		.query(async ({ ctx, input }): Promise<AiOverview> => {
			const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
			const where = { createdAt: { gte: since } };

			const [spend, outcomeRows, modelRows, toolRows, unpricedCalls, latencyRows] = await Promise.all([
				ctx.db.aiCall.groupBy({
					_sum: { costNanoUsd: true },
					by: ['billedTo'],
					where
				}),
				ctx.db.aiCall.groupBy({
					_count: { _all: true },
					by: ['outcome'],
					where
				}),
				ctx.db.aiCall.groupBy({
					_count: { _all: true },
					_sum: { costNanoUsd: true, totalTokens: true },
					by: ['resolvedModel'],
					where
				}),
				ctx.db.aiToolCall.groupBy({
					_count: { _all: true },
					by: ['toolName', 'ok'],
					where
				}),
				// pricingStatus UNKNOWN_MODEL means costNanoUsd is NULL. Never read that as 0 spend.
				ctx.db.aiCall.count({ where: { ...where, pricingStatus: 'UNKNOWN_MODEL' } }),
				ctx.db.$queryRaw<Array<{ p50: number | null; p95: number | null }>>`
					SELECT
						percentile_cont(0.5)  WITHIN GROUP (ORDER BY "latencyMs")::float8 AS p50,
						percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs")::float8 AS p95
					FROM "AiCall"
					WHERE "createdAt" >= ${since} AND "latencyMs" IS NOT NULL
				`
			]);

			const platformNanoUsd = spend.find((s) => s.billedTo === 'PLATFORM')?._sum.costNanoUsd ?? 0n;
			const userNanoUsd = spend.find((s) => s.billedTo === 'USER')?._sum.costNanoUsd ?? 0n;

			const outcomes = outcomeRows.map((row) => ({
				count: row._count._all,
				outcome: String(row.outcome)
			}));
			const calls = outcomes.reduce((sum, row) => sum + row.count, 0);
			const okCalls = outcomes.find((row) => row.outcome === 'OK')?.count ?? 0;

			const byModel = modelRows
				.map((row) => ({
					calls: row._count._all,
					costNanoUsd: row._sum.costNanoUsd ?? 0n,
					resolvedModel: row.resolvedModel,
					totalTokens: row._sum.totalTokens ?? 0
				}))
				.sort((a, b) => (b.costNanoUsd > a.costNanoUsd ? 1 : b.costNanoUsd < a.costNanoUsd ? -1 : 0));

			const toolTotals = new Map<string, { calls: number; failures: number }>();
			for (const row of toolRows) {
				const entry = toolTotals.get(row.toolName) ?? { calls: 0, failures: 0 };
				entry.calls += row._count._all;
				if (!row.ok) entry.failures += row._count._all;
				toolTotals.set(row.toolName, entry);
			}
			const tools = [...toolTotals.entries()]
				.map(([toolName, value]) => ({ calls: value.calls, failures: value.failures, toolName }))
				.sort((a, b) => b.calls - a.calls);

			// noUncheckedIndexedAccess: latencyRows[0] is `| undefined`.
			const latencyRow = latencyRows[0];

			return {
				byModel,
				latency: {
					p50: latencyRow?.p50 ?? null,
					p95: latencyRow?.p95 ?? null
				},
				outcomes: outcomes.sort((a, b) => b.count - a.count),
				tools,
				totals: {
					calls,
					failureRate: calls === 0 ? 0 : (calls - okCalls) / calls,
					platformNanoUsd,
					unpricedCalls,
					userNanoUsd
				}
			};
		})
});

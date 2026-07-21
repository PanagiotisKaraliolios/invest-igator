'use client';

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { z } from 'zod';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
// `import type` only — erased at compile time, so these server tool modules (and their
// `@/server/db` import chains) never enter the client bundle. See registry.ts's boundary note.
import type { marketPriceHistoryTool } from '@/server/ai/tools/market-price-history';
import type { portfolioPerformanceTool } from '@/server/ai/tools/portfolio-performance';

type PerformanceOutput = z.infer<typeof portfolioPerformanceTool.outputSchema>;
type PriceHistoryOutput = z.infer<typeof marketPriceHistoryTool.outputSchema>;

type Props =
	| { kind: 'market.priceHistory'; output: PriceHistoryOutput }
	| { kind: 'portfolio.performance'; output: PerformanceOutput };

/**
 * Area chart over `portfolio.performance` (`points[].nav`) or `market.priceHistory`
 * (`points[].value`) output — the two Phase 0 tools whose output is a date-ordered series.
 */
export function TimeSeries(props: Props) {
	const data =
		props.kind === 'portfolio.performance'
			? props.output.points.map((p) => ({ date: p.date, value: p.nav }))
			: props.output.points.map((p) => ({ date: p.date, value: p.value }));

	const label =
		props.kind === 'portfolio.performance'
			? `NAV (${props.output.currency})`
			: `${props.output.symbol} · ${props.output.field}`;

	if (data.length === 0) {
		return <p className='text-muted-foreground text-xs'>No data to show.</p>;
	}

	return (
		<div className='space-y-1'>
			<ChartContainer
				className='aspect-auto h-[180px] w-full max-w-md'
				config={{ value: { color: 'var(--chart-1)', label } }}
			>
				<AreaChart data={data} margin={{ bottom: 4, left: 4, right: 8, top: 4 }}>
					<CartesianGrid vertical={false} />
					<XAxis axisLine={false} dataKey='date' minTickGap={32} tickLine={false} tickMargin={8} />
					<YAxis axisLine={false} domain={['auto', 'auto']} tickLine={false} width={48} />
					<ChartTooltip content={<ChartTooltipContent indicator='line' />} cursor={true} />
					<Area
						dataKey='value'
						fill='var(--color-value)'
						fillOpacity={0.2}
						stroke='var(--color-value)'
						strokeWidth={2}
						type='monotone'
					/>
				</AreaChart>
			</ChartContainer>
			{props.kind === 'portfolio.performance' && (
				<p className='text-center text-muted-foreground text-xs'>
					TWR {props.output.twrPct.toFixed(2)}% · MWR {props.output.mwrPct.toFixed(2)}%
					{props.output.truncated ? ' (partial data)' : ''}
				</p>
			)}
			{props.kind === 'market.priceHistory' && props.output.truncated && (
				<p className='text-center text-muted-foreground text-xs'>(partial data)</p>
			)}
		</div>
	);
}

'use client';

import { Cell, Pie, PieChart } from 'recharts';
import type { z } from 'zod';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { formatCurrency } from '@/lib/currency';
// `import type` only — erased at compile time, so the server module (and its `@/server/db`
// import chain) never enters the client bundle. See registry.ts for the boundary note.
import type { portfolioStructureTool } from '@/server/ai/tools/portfolio-structure';

type Output = z.infer<typeof portfolioStructureTool.outputSchema>;

/**
 * Pie of `portfolio.structure` output. Binds ONLY to the tool's typed fields
 * (`positions[].symbol` / `weightPct`, `totalValue`, `truncated`) — never to model prose.
 */
export function PortfolioAllocation({ output }: { output: Output }) {
	const data = output.positions.map((p, i) => ({
		fill: `var(--chart-${(i % 6) + 1})`,
		name: p.symbol,
		value: Number(p.weightPct.toFixed(2))
	}));

	if (data.length === 0) {
		return <p className='text-muted-foreground text-xs'>No positions to show.</p>;
	}

	return (
		<div className='space-y-1'>
			<ChartContainer className='mx-auto aspect-square max-h-[220px] w-full max-w-[280px]' config={{}}>
				<PieChart>
					<ChartTooltip
						content={
							<ChartTooltipContent
								formatter={(value) => `${typeof value === 'number' ? value.toFixed(2) : value}%`}
								nameKey='name'
							/>
						}
						cursor={false}
					/>
					<Pie data={data} dataKey='value' nameKey='name' outerRadius={80}>
						{data.map((entry) => (
							<Cell fill={entry.fill} key={entry.name} />
						))}
					</Pie>
				</PieChart>
			</ChartContainer>
			<p className='text-center text-muted-foreground text-xs'>
				Total: {formatCurrency(output.totalValue, output.currency, 0)}
				{output.truncated ? ' (partial — showing first positions only)' : ''}
			</p>
		</div>
	);
}

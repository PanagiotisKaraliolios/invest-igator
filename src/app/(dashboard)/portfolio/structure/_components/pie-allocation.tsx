'use client';

import * as React from 'react';
import { Cell, Label, Pie, PieChart } from 'recharts';
import {
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent
} from '@/components/ui/chart';

export type PieSlice = { symbol: string; weight: number };

import { useCurrencySwitch } from '@/hooks/use-currency';
import { type Currency, formatCurrency as fx } from '@/lib/currency';

export default function PieAllocation({
	items,
	totalValue,
	currency: currencyProp
}: {
	items: PieSlice[];
	totalValue: number;
	currency?: Currency;
}) {
	const { currency: currencyHook } = useCurrencySwitch(true);
	const currency = currencyProp ?? currencyHook;
	const valueBySymbol = React.useMemo(() => {
		const m: Record<string, number> = {};
		for (const i of items) m[i.symbol] = i.weight * totalValue;
		return m;
	}, [items, totalValue]);

	const chartData = items.map((i, idx) => ({
		fill: `var(--chart-${(idx % 5) + 1})`,
		symbol: i.symbol,
		value: Number((i.weight * 100).toFixed(2))
	}));

	const chartConfig = Object.fromEntries(
		items.map((i, idx) => [
			i.symbol,
			{
				label: i.symbol,
				theme: { dark: `var(--chart-${(idx % 5) + 1})`, light: `var(--chart-${(idx % 5) + 1})` }
			}
		])
	);

	return (
		<ChartContainer className='max-w-xl w-full aspect-square' config={chartConfig as any}>
			<PieChart>
				<ChartTooltip
					content={
						<ChartTooltipContent
							formatter={(value: any, name: any, item: any) => {
								const color = item?.payload?.fill || item?.color;
								const pct = typeof value === 'number' ? value.toFixed(2) : String(value);
								const sym = item?.payload?.symbol as string | undefined;
								const usd = sym ? valueBySymbol[sym] : undefined;
								return (
									<div className='flex w-full items-start justify-between gap-4'>
										<span className='flex items-center gap-2 text-muted-foreground'>
											<span
												className='h-2.5 w-2.5 shrink-0 rounded-[2px]'
												style={{ backgroundColor: color }}
											/>
											{String(name)}
										</span>
										<span className='flex flex-col items-end leading-tight'>
											<span className='text-foreground font-mono font-medium tabular-nums'>
												{pct}%
											</span>
											{typeof usd === 'number' ? (
												<span className='text-muted-foreground font-mono tabular-nums'>
													{fx(usd, currency, 0)}
												</span>
											) : null}
										</span>
									</div>
								);
							}}
							nameKey='symbol'
						/>
					}
					cursor={false}
				/>
				<Pie data={chartData} dataKey='value' innerRadius={80} nameKey='symbol' strokeWidth={4}>
					{chartData.map((entry, index) => (
						<Cell fill={entry.fill} key={`cell-${index}`} />
					))}
					<Label
						content={({ viewBox }) => {
							if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
								return (
									<text dominantBaseline='middle' textAnchor='middle' x={viewBox.cx} y={viewBox.cy}>
										<tspan className='fill-foreground text-3xl font-bold'>
											{fx(totalValue, currency, 0)}
										</tspan>
										<tspan
											className='fill-muted-foreground text-sm'
											x={viewBox.cx}
											y={(viewBox.cy || 0) + 24}
										>
											Total value
										</tspan>
									</text>
								);
							}
							return null;
						}}
					/>
				</Pie>
				<ChartLegend content={<ChartLegendContent nameKey='symbol' />} verticalAlign='bottom' />
			</PieChart>
		</ChartContainer>
	);
}

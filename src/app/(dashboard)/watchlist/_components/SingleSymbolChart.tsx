'use client';

import { format } from 'date-fns';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent
} from '@/components/ui/chart';
import type { SeriesDatum } from './chart-utils';
import { changeClassForDelta } from './chart-utils';

type Props = {
	symbol: string;
	cssKey: string;
	series: SeriesDatum[];
	colorToken: string;
};

export default function SingleSymbolChart({ symbol, cssKey, series, colorToken }: Props) {
	const cfg: ChartConfig = { [cssKey]: { color: colorToken, label: symbol } };
	const id = `fill-${cssKey}`;
	return (
		<div className='relative'>
			<ChartContainer className='aspect-auto h-[150px] w-full sm:h-[200px]' config={cfg}>
				<AreaChart data={series} margin={{ bottom: 8, left: 12, right: 16, top: 8 }}>
					<defs>
						<linearGradient id={id} x1='0' x2='0' y1='0' y2='1'>
							<stop offset='5%' stopColor={`var(--color-${cssKey})`} stopOpacity={0.8} />
							<stop offset='95%' stopColor={`var(--color-${cssKey})`} stopOpacity={0.1} />
						</linearGradient>
					</defs>
					<CartesianGrid vertical={false} />
					<YAxis axisLine={false} tickLine={false} width={40} />
					<XAxis
						axisLine={false}
						dataKey='iso'
						minTickGap={32}
						tickFormatter={(iso) => {
							try {
								return format(new Date(iso as string), 'MMM d, yyyy');
							} catch {
								return String(iso ?? '');
							}
						}}
						tickLine={false}
						tickMargin={8}
					/>
					<ChartTooltip
						content={
							<ChartTooltipContent
								formatter={(value: unknown) => {
									const isMissing =
										value === null || value === undefined || Number(value as number) === 0;
									const numeric = isMissing ? Number.NaN : Number(value as number);
									const base = series.find((d) => Number(d.value) > 0)?.value ?? undefined;
									const pctStr =
										!isMissing && base && base !== 0 && Number.isFinite(numeric)
											? ` (${(((numeric - base) / base) * 100 >= 0 ? '+' : '') + (((numeric - base) / base) * 100).toFixed(2)}%)`
											: '';
									const colorVar = `var(--color-${cssKey})`;
									return (
										<div className='flex w-full items-center justify-between gap-3'>
											<div className='flex items-center gap-2'>
												<span
													className='h-2.5 w-2.5 rounded-[2px]'
													style={{ backgroundColor: colorVar }}
												/>
												<span className='text-muted-foreground'>{symbol}</span>
												{isMissing && (
													<span className='text-xs text-muted-foreground'>(No data)</span>
												)}
											</div>
											<div className='font-mono'>
												{!isMissing && (
													<>
														<span className='mr-1'>
															{Number.isFinite(numeric)
																? numeric.toLocaleString()
																: String(value)}
														</span>
														<span className={changeClassForDelta(numeric, base)}>
															{pctStr}
														</span>
													</>
												)}
											</div>
										</div>
									);
								}}
								indicator='dot'
								labelFormatter={(_, pl) => {
									const iso = (pl?.[0]?.payload as any)?.iso as string | undefined;
									if (!iso) return (pl?.[0]?.payload as any)?.date ?? '';
									const d = new Date(iso);
									return format(d, 'MMM d, yyyy');
								}}
								nameKey={symbol}
							/>
						}
						cursor={false}
					/>
					<Area
						connectNulls
						dataKey='value'
						fill={`url(#${id})`}
						stroke={`var(--color-${cssKey})`}
						strokeWidth={2}
						type='monotone'
					/>
					<ChartLegend content={<ChartLegendContent nameKey={symbol} />} />
				</AreaChart>
			</ChartContainer>
			{series.length === 0 && (
				<div className='pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground'>
					No data
				</div>
			)}
			<div className='mt-1 text-center text-xs text-muted-foreground'>{symbol}</div>
		</div>
	);
}

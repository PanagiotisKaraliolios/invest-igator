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
import { changeClassForDelta } from './chart-utils';

type Props = {
	data: any[];
	cssKeys: string[];
	chartConfig: ChartConfig;
	baselineByCssKey: Record<string, number>;
	className?: string;
};

export default function CombinedAreaChart({ data, cssKeys, chartConfig, baselineByCssKey, className }: Props) {
	return (
		<ChartContainer className={className ?? 'aspect-auto h-[220px] w-full sm:h-[260px]'} config={chartConfig}>
			<AreaChart data={data} margin={{ bottom: 8, left: 12, right: 16, top: 8 }}>
				<defs>
					{cssKeys.map((cssKey) => (
						<linearGradient id={`fill-${cssKey}`} key={cssKey} x1='0' x2='0' y1='0' y2='1'>
							<stop offset='5%' stopColor={`var(--color-${cssKey})`} stopOpacity={0.8} />
							<stop offset='95%' stopColor={`var(--color-${cssKey})`} stopOpacity={0.1} />
						</linearGradient>
					))}
				</defs>
				<CartesianGrid vertical={false} />
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
				<YAxis axisLine={false} tickLine={false} width={40} />
				<ChartTooltip
					content={
						<ChartTooltipContent
							formatter={(value: unknown, name: unknown) => {
								const cssKey = String(name);
								const isMissing =
									value === null || value === undefined || Number(value as number) === 0;
								const numeric = isMissing ? Number.NaN : Number(value as number);
								const base = baselineByCssKey[cssKey];
								const pct =
									!isMissing && base && base !== 0 && Number.isFinite(numeric)
										? ` (${(((numeric - base) / base) * 100 >= 0 ? '+' : '') + (((numeric - base) / base) * 100).toFixed(2)}%)`
										: '';
								const colorVar = `var(--color-${cssKey})`;
								const label = (chartConfig as any)?.[cssKey]?.label ?? cssKey;
								return (
									<div className='flex w-full items-center justify-between gap-3'>
										<div className='flex items-center gap-2'>
											<span
												className='h-2.5 w-2.5 rounded-[2px]'
												style={{ backgroundColor: colorVar }}
											/>
											<span className='text-muted-foreground'>{String(label)}</span>
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
													<span className={changeClassForDelta(numeric, base)}>{pct}</span>
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
						/>
					}
					cursor={false}
				/>
				{cssKeys.map((cssKey) => (
					<Area
						connectNulls
						dataKey={cssKey}
						fill={`url(#fill-${cssKey})`}
						key={cssKey}
						stroke={`var(--color-${cssKey})`}
						strokeWidth={2}
						type='linear'
					/>
				))}
				<ChartLegend content={<ChartLegendContent />} />
			</AreaChart>
		</ChartContainer>
	);
}

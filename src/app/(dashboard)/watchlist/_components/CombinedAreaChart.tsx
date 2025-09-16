'use client';

import { format } from 'date-fns';
import * as React from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceDot, XAxis, YAxis } from 'recharts';
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent
} from '@/components/ui/chart';
import { changeClassForDelta, type EventPoint, eventColor, eventGlyph, formatEventText, toCssKey } from './chart-utils';

export type CombinedRow = Record<string, unknown> & { iso: string };

type Props = {
	data: CombinedRow[];
	cssKeys: string[];
	chartConfig: ChartConfig;
	baselineByCssKey: Record<string, number>;
	className?: string;
	eventsByCssKey?: Record<string, EventPoint[]>;
	showEvents?: boolean;
};

export default function CombinedAreaChart(props: Props) {
	const { data, cssKeys, chartConfig, baselineByCssKey, className, eventsByCssKey, showEvents = false } = props;

	const eventsCount = React.useMemo(() => {
		if (!showEvents || !eventsByCssKey) return 0;
		let n = 0;
		for (const k of Object.keys(eventsByCssKey)) n += eventsByCssKey[k]?.length ?? 0;
		return n;
	}, [showEvents, eventsByCssKey]);

	return (
		<ChartContainer
			className={className ?? 'aspect-auto h-[220px] w-full sm:h-[260px]'}
			config={chartConfig}
			key={`cc-${showEvents}-${eventsCount}`}
		>
			<AreaChart
				data={data}
				key={`${showEvents}-${eventsCount}`}
				margin={{ bottom: 8, left: 12, right: 16, top: 8 }}
			>
				{/* <defs>
					{cssKeys.map((cssKey) => (
						<linearGradient id={`fill-${cssKey}`} key={cssKey} x1='0' x2='0' y1='0' y2='1'>
							<stop offset='5%' stopColor={`var(--color-${cssKey})`} stopOpacity={0.8} />
							<stop offset='95%' stopColor={`var(--color-${cssKey})`} stopOpacity={0.1} />
						</linearGradient>
					))}
				</defs> */}
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
							formatter={(value: unknown, name: unknown, item?: any) => {
								const cssKey = name ? toCssKey(String(name)) : '';
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
								const evsKey = `${cssKey}_events`;
								const row = item?.payload as CombinedRow | undefined;
								const evs = showEvents
									? (((row?.[evsKey] as EventPoint[] | undefined) ?? []) as EventPoint[])
									: ([] as EventPoint[]);
								return (
									<div className='flex w-full flex-col gap-1'>
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
										{evs.length > 0 && (
											<div className='mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground'>
												{evs.map((ev, i) => (
													<span className='flex items-center gap-1' key={i}>
														<span
															className='inline-flex h-1.5 w-1.5 rounded-full'
															style={{ backgroundColor: eventColor(ev.type) }}
														/>
														<span className='font-semibold'>{eventGlyph(ev.type)}</span>
														<span>{formatEventText(ev)}</span>
													</span>
												))}
											</div>
										)}
									</div>
								);
							}}
							indicator='dot'
							labelFormatter={(_: any, pl: any[]) => {
								const iso = (pl?.[0]?.payload as any)?.iso as string | undefined;
								if (!iso) return (pl?.[0]?.payload as any)?.date ?? '';
								const d = new Date(iso);
								return format(d, 'MMM d, yyyy');
							}}
						/>
					}
					cursor={true}
				/>
				{cssKeys.map((cssKey) => (
					<Area
						activeDot={(props: any) => {
							const evs = props?.payload?.[`${cssKey}_events`] as EventPoint[] | undefined;
							const hasEv = showEvents && evs?.length;
							if (!hasEv)
								return (
									<circle
										cx={props.cx}
										cy={props.cy}
										fill={`var(--color-${cssKey})`}
										r={4}
										stroke='var(--background)'
										strokeWidth={1}
									/>
								);
							return (
								<g>
									<circle
										cx={props.cx}
										cy={props.cy}
										fill={eventColor(evs![0]!.type)}
										r={6}
										stroke='var(--background)'
										strokeWidth={1}
									/>
								</g>
							);
						}}
						connectNulls
						dataKey={cssKey}
						dot={(props: any) => {
							const evs = props?.payload?.[`${cssKey}_events`] as EventPoint[] | undefined;
							const hasEv = showEvents && evs?.length;
							const idx = props?.index ?? 0;
							if (!hasEv) return <g key={`dot-empty-${cssKey}-${idx}`} />;
							return (
								<circle
									cx={props.cx}
									cy={props.cy}
									fill={eventColor(evs![0]!.type)}
									key={`dot-ev-${cssKey}-${idx}`}
									r={4}
									stroke='var(--background)'
									strokeWidth={1}
								/>
							);
						}}
						fill={`url(#fill-${cssKey})`}
						key={cssKey}
						stroke={`var(--color-${cssKey})`}
						strokeWidth={2}
						type='linear'
					/>
				))}
				{/* ReferenceDots removed; using dot renderer for persistent markers */}
				<ChartLegend content={<ChartLegendContent />} />
			</AreaChart>
		</ChartContainer>
	);
}

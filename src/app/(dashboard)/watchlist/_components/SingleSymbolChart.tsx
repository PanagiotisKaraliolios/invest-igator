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
import type { EventPoint, SeriesDatum } from './chart-utils';
import { changeClassForDelta, eventColor, eventGlyph, formatEventText } from './chart-utils';

type Props = {
	symbol: string;
	cssKey: string;
	series: SeriesDatum[];
	colorToken: string;
	events?: EventPoint[];
	showEvents?: boolean;
};

export default function SingleSymbolChart({ symbol, cssKey, series, colorToken, events, showEvents = false }: Props) {
	const cfg: ChartConfig = { [cssKey]: { color: colorToken, label: symbol } };
	const id = `fill-${cssKey}`;

	const evCount = React.useMemo(() => (showEvents ? (events?.length ?? 0) : 0), [showEvents, events]);

	return (
		<div className='relative'>
			<ChartContainer
				className='aspect-auto h-[150px] w-full sm:h-[200px]'
				config={cfg}
				key={`cc-${cssKey}-${showEvents}-${evCount}`}
			>
				<AreaChart
					data={series}
					key={`${cssKey}-${showEvents}-${evCount}`}
					margin={{ bottom: 8, left: 12, right: 16, top: 8 }}
				>
					{/* <defs>
						<linearGradient id={id} x1='0' x2='0' y1='0' y2='1'>
							<stop offset='5%' stopColor={`var(--color-${cssKey})`} stopOpacity={0.8} />
							<stop offset='95%' stopColor={`var(--color-${cssKey})`} stopOpacity={0.1} />
						</linearGradient>
					</defs> */}
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
								formatter={(
									value: unknown,
									_name?: unknown,
									_item?: unknown,
									_index?: number,
									payload?: any
								) => {
									const isMissing =
										value === null || value === undefined || Number(value as number) === 0;
									const numeric = isMissing ? Number.NaN : Number(value as number);
									const base = series.find((d) => Number(d.value) > 0)?.value ?? undefined;
									const pctStr =
										!isMissing && base && base !== 0 && Number.isFinite(numeric)
											? ` (${(((numeric - base) / base) * 100 >= 0 ? '+' : '') + (((numeric - base) / base) * 100).toFixed(2)}%)`
											: '';
									const colorVar = `var(--color-${cssKey})`;
									const evs = showEvents ? ((payload?.events as EventPoint[] | undefined) ?? []) : [];
									return (
										<div className='flex w-full flex-col gap-1'>
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
											{showEvents && evs.length > 0 && (
												<div className='mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground'>
													{evs.map((ev, i) => (
														<span
															className='flex items-center justify-center gap-1'
															key={i}
														>
															<span
																className='inline-block size-2 rounded-full align-middle'
																style={{ backgroundColor: eventColor(ev.type) }}
															/>
															<span className='inline-flex items-center font-semibold align-middle text-center'>
																{eventGlyph(ev.type)}
															</span>
															<span className='inline-flex items-center align-middle text-center'>
																{formatEventText(ev)}
															</span>
														</span>
													))}
												</div>
											)}
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
						cursor={true}
					/>
					<Area
						activeDot={(props: any) => {
							const evs = props?.payload?.events as EventPoint[] | undefined;
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
						dataKey='value'
						dot={(props: any) => {
							const evs = props?.payload?.events as EventPoint[] | undefined;
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
						fill={`url(#${id})`}
						stroke={`var(--color-${cssKey})`}
						strokeWidth={2}
						type='monotone'
					/>
					{/* ReferenceDots removed in favor of dot renderer for reliability */}
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

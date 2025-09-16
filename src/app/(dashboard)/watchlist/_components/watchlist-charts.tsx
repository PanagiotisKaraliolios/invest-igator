'use client';

import { differenceInCalendarDays, format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import * as React from 'react';
import type { DateRange } from 'react-day-picker';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent
} from '@/components/ui/chart';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { api } from '@/trpc/react';

type CombinedDatum = {
	date: string;
	iso: string;
	// dynamic keys per symbol; allow null/undefined for "no data" points
	[cssKey: string]: string | number | null | undefined;
};

type SeriesDatum = { date: string; iso?: string; value: number };

// Downsample by striding to cap the number of points for performance
function downsample<T>(arr: T[], maxPoints: number): T[] {
	if (!Array.isArray(arr)) return arr;
	const n = arr.length;
	if (n <= maxPoints) return arr;
	const stride = Math.ceil(n / maxPoints);
	const out: T[] = [];
	for (let i = 0; i < n; i += stride) out.push(arr[i]!);
	// ensure last sample included
	if (out[out.length - 1] !== arr[n - 1]) out.push(arr[n - 1]!);
	return out;
}

function hashStringToSeed(str: string) {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

function mulberry32(seed: number) {
	return function () {
		let s = seed;
		s += 0x6d2b79f5;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function generateSeries(symbol: string, points = 30): SeriesDatum[] {
	const seed = hashStringToSeed(symbol);
	const rand = mulberry32(seed);
	const start = 50 + Math.floor(rand() * 250);
	const volatility = 0.02 + rand() * 0.03; // 2% - 5%
	const out: SeriesDatum[] = [];
	let price = start;
	for (let i = points - 1; i >= 0; i--) {
		// simulate daily returns
		const drift = (rand() - 0.5) * volatility;
		price = Math.max(5, price * (1 + drift));
		const d = new Date();
		d.setDate(d.getDate() - i);
		out.push({
			date: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
			iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
			value: Math.round(price * 100) / 100
		});
	}
	return out;
}

// Provide up to 12 color tokens that ChartContainer maps to CSS vars per series key.
const colorTokens = Array.from({ length: 12 }, (_, i) => `var(--chart-${i + 1})`);

// Sanitize a symbol to a safe CSS custom property key
function toCssKey(sym: string) {
	return sym.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function percentChange(value?: number, base?: number): number | null {
	if (base === undefined || base === null || base === 0) return null;
	if (value === undefined || value === null || !Number.isFinite(Number(value))) return null;
	return ((Number(value) - base) / base) * 100;
}

function changeClassForDelta(value?: number, base?: number) {
	const pct = percentChange(value, base);
	if (pct === null) return 'text-muted-foreground';
	if (pct > 0) return 'text-emerald-500';
	if (pct < 0) return 'text-red-500';
	return 'text-muted-foreground';
}

export default function WatchlistCharts() {
	const { data: items, isLoading: listLoading, error: listError } = api.watchlist.list.useQuery();
	const starredSymbols = (items ?? []).filter((i) => i.starred).map((i) => i.symbol);
	const symbols = starredSymbols.slice(0, 5);

	// Max 50 years of daily data
	const MAX_DAYS = 365 * 50;

	// Date range state (default: last 180 days)
	const initialTo = React.useMemo(() => new Date(), []);
	const initialFrom = React.useMemo(() => {
		const d = new Date();
		d.setDate(d.getDate() - 179);
		return d;
	}, []);
	const [dateRange, setDateRange] = React.useState<DateRange>({ from: initialFrom, to: initialTo });
	type Preset = '5D' | '1M' | '6M' | 'YTD' | '1Y' | '5Y' | '10Y' | '20Y' | 'MAX' | null;
	const [preset, setPreset] = React.useState<Preset>('6M');

	const applyPreset = React.useCallback((p: Exclude<Preset, null>) => {
		const now = new Date();
		let from = new Date(now);
		switch (p) {
			case '5D':
				from.setDate(now.getDate() - 4);
				break;
			case '1M':
				from.setDate(now.getDate() - 29);
				break;
			case '6M':
				from.setDate(now.getDate() - 179);
				break;
			case 'YTD':
				from = new Date(now.getFullYear(), 0, 1);
				break;
			case '1Y':
				from.setDate(now.getDate() - 364);
				break;
			case '5Y':
				from.setDate(now.getDate() - 1824);
				break;
			case '10Y':
				from.setDate(now.getDate() - 3649);
				break;
			case '20Y':
				from.setDate(now.getDate() - 7299);
				break;
			case 'MAX':
				from.setDate(now.getDate() - (MAX_DAYS - 1));
				break;
		}
		setDateRange({ from, to: now });
		setPreset(p);
	}, []);

	const fromDate = dateRange.from ?? initialFrom;
	const toDate = dateRange.to ?? initialTo;
	// Server expects days from now back; compute from selected start
	const daysForServer = React.useMemo(() => {
		const now = new Date();
		const start = fromDate ?? now;
		const computed = Math.max(1, differenceInCalendarDays(now, start) + 1);
		return Math.min(MAX_DAYS, computed);
	}, [fromDate]);

	const {
		data: history,
		isLoading,
		isFetching,
		error: historyError,
		refetch
	} = api.watchlist.history.useQuery(
		{ days: daysForServer, field: 'close', symbols },
		{
			enabled: symbols.length > 0
		}
	);
	const loading = listLoading || isLoading || isFetching;
	const error = listError ?? historyError;

	const [combined, setCombined] = React.useState(true);

	// Build stable CSS keys for symbols (used for ChartContainer color mapping and gradient IDs)
	const cssKeys = React.useMemo(() => symbols.map((s) => toCssKey(s)), [symbols]);

	// Build chart config mapping cssKey -> color token and display label
	const chartConfig: ChartConfig = React.useMemo(() => {
		const cfg: ChartConfig = {};
		cssKeys.forEach((cssKey, idx) => {
			cfg[cssKey] = { color: colorTokens[idx % colorTokens.length], label: symbols[idx]! };
		});
		return cfg;
	}, [cssKeys, symbols]);

	// Choose data source: prefer Influx history if available, otherwise fallback to mock.
	const seriesBySymbol: Record<string, SeriesDatum[]> = React.useMemo(() => {
		const out: Record<string, SeriesDatum[]> = {};
		if (history?.series && Object.keys(history.series).length > 0) {
			const fromKey = format(fromDate, 'yyyy-MM-dd');
			const toKey = format(toDate, 'yyyy-MM-dd');
			for (const sym of symbols) {
				const points = (history.series[sym] ?? []).filter((p) => p.date >= fromKey && p.date <= toKey);
				const mapped = points.map((p) => ({
					date: new Date(p.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
					iso: p.date,
					value: p.value
				}));
				out[sym] = downsample(mapped, 1500);
			}
		} else {
			for (const sym of symbols) out[sym] = downsample(generateSeries(sym, 1000), 600);
		}
		return out;
	}, [history, symbols, fromDate, toDate]);

	// Build combined dataset: one row per date with keys for each symbol
	const combinedData: CombinedDatum[] = React.useMemo(() => {
		const per = symbols.map((s, idx) => ({ cssKey: cssKeys[idx]!, data: seriesBySymbol[s] ?? [] }));
		if (per.length === 0) return [];
		// Align by index using the shortest non-empty series
		const nonEmptyLengths = per.map((p) => p.data.length).filter((n) => n > 0);
		if (nonEmptyLengths.length === 0) return [];
		const len = Math.min(...nonEmptyLengths);
		const base = per.find((p) => p.data.length > 0);
		if (!base) return [];
		const byIndex: CombinedDatum[] = [];
		for (let i = 0; i < len; i++) {
			const row: CombinedDatum = { date: base.data[i]!.date, iso: base.data[i]!.iso ?? '' };
			per.forEach(({ cssKey, data }) => {
				// Use null for missing values so the area is not drawn and tooltips can show "No data".
				row[cssKey] = Number.isFinite(data[i]?.value as number) ? (data[i] as any)?.value : null;
			});
			byIndex.push(row);
		}
		return downsample(byIndex, 600);
	}, [symbols, cssKeys, seriesBySymbol]);

	// Precompute baseline (first non-zero) per series for percent change in tooltip
	const baselineByCssKey = React.useMemo(() => {
		const map: Record<string, number> = {};
		symbols.forEach((sym, idx) => {
			const cssKey = cssKeys[idx]!;
			const ser = seriesBySymbol[sym] ?? [];
			const first = ser.find((d) => Number(d.value) > 0);
			if (first && Number.isFinite(first.value)) map[cssKey] = Number(first.value);
		});
		return map;
	}, [symbols, cssKeys, seriesBySymbol]);

	return (
		<Card>
			<CardHeader className='flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between'>
				<CardTitle>Charts</CardTitle>
				<div className='flex flex-wrap items-center gap-2'>
					<Popover>
						<PopoverTrigger asChild>
							<Button className='h-8 gap-2' variant='outline'>
								<CalendarIcon className='h-4 w-4' />
								{dateRange.from && dateRange.to ? (
									<span>
										{format(dateRange.from, 'MMM d, yyyy')} – {format(dateRange.to, 'MMM d, yyyy')}
									</span>
								) : (
									<span>Pick date range</span>
								)}
							</Button>
						</PopoverTrigger>
						<PopoverContent align='end' className='w-auto p-0'>
							<div className='flex flex-wrap items-center gap-1 p-2 pb-0'>
								<Button
									onClick={() => applyPreset('5D')}
									size='sm'
									variant={preset === '5D' ? 'default' : 'ghost'}
								>
									5D
								</Button>
								<Button
									onClick={() => applyPreset('1M')}
									size='sm'
									variant={preset === '1M' ? 'default' : 'ghost'}
								>
									1M
								</Button>
								<Button
									onClick={() => applyPreset('6M')}
									size='sm'
									variant={preset === '6M' ? 'default' : 'ghost'}
								>
									6M
								</Button>
								<Button
									onClick={() => applyPreset('YTD')}
									size='sm'
									variant={preset === 'YTD' ? 'default' : 'ghost'}
								>
									YTD
								</Button>
								<Button
									onClick={() => applyPreset('1Y')}
									size='sm'
									variant={preset === '1Y' ? 'default' : 'ghost'}
								>
									1Y
								</Button>
								<Button
									onClick={() => applyPreset('5Y')}
									size='sm'
									variant={preset === '5Y' ? 'default' : 'ghost'}
								>
									5Y
								</Button>
								<Button
									onClick={() => applyPreset('10Y')}
									size='sm'
									variant={preset === '10Y' ? 'default' : 'ghost'}
								>
									10Y
								</Button>
								<Button
									onClick={() => applyPreset('20Y')}
									size='sm'
									variant={preset === '20Y' ? 'default' : 'ghost'}
								>
									20Y
								</Button>
								<Button
									onClick={() => applyPreset('MAX')}
									size='sm'
									variant={preset === 'MAX' ? 'default' : 'ghost'}
								>
									Max
								</Button>
							</div>
							<Calendar
								mode='range'
								numberOfMonths={2}
								onSelect={(r) => {
									setDateRange(r ?? { from: initialFrom, to: initialTo });
									setPreset(null);
								}}
								selected={dateRange}
							/>
						</PopoverContent>
					</Popover>
					<Label htmlFor='combined-chart'>Combined</Label>
					<Switch checked={combined} id='combined-chart' onCheckedChange={setCombined} />
				</div>
			</CardHeader>
			<CardContent className='space-y-4'>
				{error ? (
					<Alert variant='destructive'>
						<AlertTitle>Failed to load charts</AlertTitle>
						<AlertDescription className='flex items-center justify-between gap-4'>
							<span className='truncate'>
								{typeof error?.message === 'string'
									? error.message
									: 'An unexpected error occurred while fetching data.'}
							</span>
							<Button disabled={loading} onClick={() => refetch()} size='sm' variant='secondary'>
								Retry
							</Button>
						</AlertDescription>
					</Alert>
				) : loading ? (
					combined ? (
						<Skeleton aria-busy aria-label='Loading chart' className='h-[220px] w-full sm:h-[260px]' />
					) : (
						<div className={`grid grid-cols-1 gap-4 ${symbols.length > 1 ? 'md:grid-cols-2' : ''}`}>
							{(symbols.length > 0 ? symbols : Array.from({ length: 2 })).map((_, idx) => (
								<Skeleton
									aria-busy
									aria-label='Loading chart'
									className='h-[140px] w-full sm:h-[160px]'
									key={idx}
								/>
							))}
						</div>
					)
				) : symbols.length === 0 ? (
					<div className='flex h-[220px] w-full items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground sm:h-[260px]'>
						{!items || items.length === 0
							? 'Your watchlist is empty. Add symbols to see charts.'
							: 'No starred symbols. Star up to 5 to show charts.'}
					</div>
				) : combined ? (
					<ChartContainer className='aspect-auto h-[220px] w-full sm:h-[260px]' config={chartConfig}>
						<AreaChart data={combinedData} margin={{ bottom: 8, left: 12, right: 16, top: 8 }}>
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
															<span className='text-xs text-muted-foreground'>
																(No data)
															</span>
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
																	{pct}
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
									// isAnimationActive={combinedData.length < 800}
								/>
							))}
							<ChartLegend content={<ChartLegendContent />} />
						</AreaChart>
					</ChartContainer>
				) : (
					<div className={`grid grid-cols-1 gap-4 ${symbols.length > 1 ? 'md:grid-cols-2' : ''}`}>
						{symbols.map((sym, idx) => {
							const series = seriesBySymbol[sym] ?? [];
							const cssKey = cssKeys[idx]!;
							const cfg: ChartConfig = {
								[cssKey]: { color: colorTokens[idx % colorTokens.length], label: sym }
							};
							const id = `fill-${cssKey}`;
							return (
								<div className='relative' key={sym}>
									<ChartContainer className='aspect-auto h-[150px] w-full sm:h-[200px]' config={cfg}>
										<AreaChart data={series} margin={{ bottom: 8, left: 12, right: 16, top: 8 }}>
											<defs>
												<linearGradient id={id} x1='0' x2='0' y1='0' y2='1'>
													<stop
														offset='5%'
														stopColor={`var(--color-${cssKey})`}
														stopOpacity={0.8}
													/>
													<stop
														offset='95%'
														stopColor={`var(--color-${cssKey})`}
														stopOpacity={0.1}
													/>
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
																value === null ||
																value === undefined ||
																Number(value as number) === 0;
															const numeric = isMissing
																? Number.NaN
																: Number(value as number);
															const base =
																series.find((d) => Number(d.value) > 0)?.value ??
																undefined;
															const pctStr =
																!isMissing &&
																base &&
																base !== 0 &&
																Number.isFinite(numeric)
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
																		<span className='text-muted-foreground'>
																			{sym}
																		</span>
																		{isMissing && (
																			<span className='text-xs text-muted-foreground'>
																				(No data)
																			</span>
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
																				<span
																					className={changeClassForDelta(
																						numeric,
																						base
																					)}
																				>
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
															const iso = (pl?.[0]?.payload as any)?.iso as
																| string
																| undefined;
															if (!iso) return (pl?.[0]?.payload as any)?.date ?? '';
															const d = new Date(iso);
															return format(d, 'MMM d, yyyy');
														}}
														nameKey={sym}
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
												// isAnimationActive={(series?.length ?? 0) < 800}
											/>
											<ChartLegend content={<ChartLegendContent nameKey={sym} />} />
										</AreaChart>
									</ChartContainer>
									{series.length === 0 && (
										<div className='pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground'>
											No data
										</div>
									)}
									<div className='mt-1 text-center text-xs text-muted-foreground'>{sym}</div>
								</div>
							);
						})}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

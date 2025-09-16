'use client';

import { format } from 'date-fns';
import * as React from 'react';
import type { DateRange } from 'react-day-picker';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig } from '@/components/ui/chart';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { api } from '@/trpc/react';
import CombinedAreaChart from './CombinedAreaChart';
import type { CombinedDatum, SeriesDatum } from './chart-utils';
import { colorTokens, daysBackFromRange, downsample, generateSeries, toCssKey } from './chart-utils';
import DateRangePicker, { applyPresetToRange, type Preset } from './DateRangePicker';
import SingleSymbolChart from './SingleSymbolChart';

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
	const [preset, setPreset] = React.useState<Preset>('6M');

	const applyPreset = React.useCallback((p: Exclude<Preset, null>) => {
		const r = applyPresetToRange(p, MAX_DAYS);
		setDateRange(r);
		setPreset(p);
	}, []);

	const fromDate = dateRange.from ?? initialFrom;
	const toDate = dateRange.to ?? initialTo;
	// Server expects days from now back; compute from selected start
	const daysForServer = React.useMemo(() => daysBackFromRange(fromDate), [fromDate]);

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
				out[sym] = downsample(mapped, 3000);
			}
		} else {
			for (const sym of symbols) out[sym] = downsample(generateSeries(sym, 1000), 3000);
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
		return downsample(byIndex, 3000);
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
					<DateRangePicker
						buttonClassName='h-8 gap-2'
						dateRange={dateRange}
						maxDays={MAX_DAYS}
						onChange={(r) => setDateRange(r ?? { from: initialFrom, to: initialTo })}
						onPresetChange={setPreset}
						preset={preset}
					/>
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
					<CombinedAreaChart
						baselineByCssKey={baselineByCssKey}
						chartConfig={chartConfig}
						cssKeys={cssKeys}
						data={combinedData}
					/>
				) : (
					<div className={`grid grid-cols-1 gap-4 ${symbols.length > 1 ? 'md:grid-cols-2' : ''}`}>
						{symbols.map((sym, idx) => (
							<SingleSymbolChart
								colorToken={colorTokens[idx % colorTokens.length]!}
								cssKey={cssKeys[idx]!}
								key={sym}
								series={seriesBySymbol[sym] ?? []}
								symbol={sym}
							/>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

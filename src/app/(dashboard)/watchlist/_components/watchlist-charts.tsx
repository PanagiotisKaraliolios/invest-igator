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
import type { CombinedDatum, EventPoint, SeriesDatum } from './chart-utils';
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
	const [showEvents, setShowEvents] = React.useState(false);

	// Fetch corporate events for symbols within range
	const { data: eventsData } = api.watchlist.events.useQuery(
		{ days: daysForServer, symbols },
		{ enabled: symbols.length > 0 }
	);

	// Map API events to normalized EventPoint[] per symbol, filtered by selected range
	const eventsBySymbol: Record<string, EventPoint[]> = React.useMemo(() => {
		const out: Record<string, EventPoint[]> = {};
		if (!eventsData?.events) return out;
		const fromKey = format(fromDate, 'yyyy-MM-dd');
		const toKey = format(toDate, 'yyyy-MM-dd');
		for (const sym of symbols) {
			const bucket = (eventsData.events as any)[sym];
			if (!bucket) continue;
			const arr: EventPoint[] = [];
			for (const d of bucket.dividends ?? []) {
				if (d.date >= fromKey && d.date <= toKey)
					arr.push({ date: d.date, type: 'dividend', value: Number(d.amount) });
			}
			for (const s of bucket.splits ?? []) {
				if (s.date >= fromKey && s.date <= toKey) {
					const label =
						s.numerator && s.denominator ? `${s.numerator}:${s.denominator}` : String(s.ratio ?? '');
					arr.push({ date: s.date, label, type: 'split', value: Number(s.ratio ?? 0) });
				}
			}
			for (const c of bucket.capitalGains ?? []) {
				if (c.date >= fromKey && c.date <= toKey)
					arr.push({ date: c.date, type: 'capitalGain', value: Number(c.amount) });
			}
			out[sym] = arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
		}
		return out;
	}, [eventsData, symbols, fromDate, toDate]);

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
				out[sym] = mapped;
			}
		} else {
			for (const sym of symbols) out[sym] = generateSeries(sym, 1000);
		}
		return out;
	}, [history, symbols, fromDate, toDate]);

	// Inject event rows at exact event dates; carry-forward nearest value; flag rows for preservation
	const seriesWithEventsBySymbol: Record<string, SeriesDatum[]> = React.useMemo(() => {
		const out: Record<string, SeriesDatum[]> = {};
		for (const sym of symbols) {
			const base = [...(seriesBySymbol[sym] ?? [])].sort((a, b) =>
				a.iso! < b.iso! ? -1 : a.iso! > b.iso! ? 1 : 0
			);
			if (!showEvents) {
				out[sym] = downsample(base, 1000);
				continue;
			}
			// Build a map for quick lookup
			const byIso = new Map(base.map((p) => [p.iso!, p]) as [string, SeriesDatum][]);
			const evs = eventsBySymbol[sym] ?? [];
			// Ensure an entry exists for each event date
			for (const ev of evs) {
				if (byIso.has(ev.date)) continue;
				// Find nearest neighbor for value carry-forward (prefer previous, else next)
				let prev: SeriesDatum | undefined;
				let next: SeriesDatum | undefined;
				for (let i = base.length - 1; i >= 0; i--) {
					if ((base[i]!.iso ?? '') < ev.date) {
						prev = base[i];
						break;
					}
				}
				for (let i = 0; i < base.length; i++) {
					if ((base[i]!.iso ?? '') > ev.date) {
						next = base[i];
						break;
					}
				}
				const ref = prev ?? next;
				if (ref) {
					const d = new Date(ev.date);
					const injected: SeriesDatum & { preserve?: boolean } = {
						date: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
						events: undefined,
						iso: ev.date,
						preserve: true,
						value: ref.value
					};
					byIso.set(ev.date, injected);
				}
			}
			// Attach events to their exact date rows
			for (const ev of evs) {
				const row = byIso.get(ev.date);
				if (!row) continue;
				(row as any).events = [...(((row as any).events as EventPoint[] | undefined) ?? []), ev];
				(row as any).preserve = true;
			}
			const merged = Array.from(byIso.values()).sort((a, b) => (a.iso! < b.iso! ? -1 : a.iso! > b.iso! ? 1 : 0));
			// Downsample but preserve rows flagged as preserve/events
			const ds = downsample(merged as any, 1000, {
				preserve: (v: any) => Boolean(v?.preserve || (v?.events && v.events.length > 0))
			});
			out[sym] = ds.map(({ preserve: _p, ...rest }: any) => rest);
		}
		return out;
	}, [symbols, seriesBySymbol, eventsBySymbol, showEvents]);

	// Build combined dataset via ISO union across all series and event dates; preserve event rows
	const combinedData: CombinedDatum[] = React.useMemo(() => {
		if (symbols.length === 0) return [];
		// Collect ISO union from series and raw event dates
		const isoSet = new Set<string>();
		const per = symbols.map((s, idx) => ({
			cssKey: cssKeys[idx]!,
			data: seriesWithEventsBySymbol[s] ?? [],
			sym: s
		}));
		for (const { data } of per) for (const d of data) if (d.iso) isoSet.add(d.iso);
		if (showEvents) for (const s of symbols) for (const ev of eventsBySymbol[s] ?? []) isoSet.add(ev.date);
		const isos = Array.from(isoSet.values()).sort();
		if (isos.length === 0) return [];
		const byIsoRow: CombinedDatum[] & { preserve?: boolean }[] = [] as any;
		for (const iso of isos) {
			const d = new Date(iso);
			const dateLabel = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
			const row: any = { date: dateLabel, iso };
			let rowHasEvent = false;
			for (const { cssKey, data, sym } of per) {
				const pt = data.find((p) => p.iso === iso);
				row[cssKey] = Number.isFinite(pt?.value as number) ? (pt as any)?.value : null;
				if (showEvents) {
					const evs = pt?.events ?? [];
					if (evs.length > 0) {
						row[`${cssKey}_events`] = evs;
						rowHasEvent = true;
					}
				}
			}
			(row as any).preserve = rowHasEvent;
			byIsoRow.push(row);
		}
		const ds = downsample(byIsoRow as any, 1000, {
			preserve: (v: any) => Boolean(v?.preserve)
		});
		return ds.map(({ preserve: _p, ...rest }: any) => rest);
	}, [symbols, cssKeys, seriesWithEventsBySymbol, eventsBySymbol, showEvents]);

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

	// Map to cssKey for combined chart
	const eventsByCssKey = React.useMemo(() => {
		const map: Record<string, EventPoint[]> = {};
		symbols.forEach((sym, idx) => {
			map[cssKeys[idx]!] = eventsBySymbol[sym] ?? [];
		});
		return map;
	}, [symbols, cssKeys, eventsBySymbol]);

	// Signature string changes when event sets (dates/types) change
	const eventsSignature = React.useMemo(() => {
		return symbols.map((s) => (eventsBySymbol[s] ?? []).map((e) => `${e.date}:${e.type}`).join(',')).join('|');
	}, [symbols, eventsBySymbol]);

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
					<Label htmlFor='show-events'>Show events</Label>
					<Switch checked={showEvents} id='show-events' onCheckedChange={setShowEvents} />
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
					<div key={`combined-wrap-${showEvents}-${eventsSignature}`}>
						<CombinedAreaChart
							baselineByCssKey={baselineByCssKey}
							chartConfig={chartConfig}
							cssKeys={cssKeys}
							data={combinedData}
							eventsByCssKey={showEvents ? eventsByCssKey : {}}
							key={`combined-${showEvents}-${eventsSignature}`}
							showEvents={showEvents}
						/>
					</div>
				) : (
					<div className={`grid grid-cols-1 gap-4 ${symbols.length > 1 ? 'md:grid-cols-2' : ''}`}>
						{symbols.map((sym, idx) => (
							<SingleSymbolChart
								colorToken={colorTokens[idx % colorTokens.length]!}
								cssKey={cssKeys[idx]!}
								events={showEvents ? (eventsBySymbol[sym] ?? []) : []}
								key={`${sym}-${showEvents}-${(eventsBySymbol[sym] ?? [])
									.map((e) => `${e.date}:${e.type}`)
									.join(',')}`}
								series={seriesWithEventsBySymbol[sym] ?? []}
								showEvents={showEvents}
								symbol={sym}
							/>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

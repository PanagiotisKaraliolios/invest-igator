'use client';

import { useMemo, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartLegendContent, ChartTooltipContent } from '@/components/ui/chart';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useCurrencySwitch } from '@/hooks/use-currency';
import { type Currency, formatCurrency } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { api } from '@/trpc/react';

type Mode = 'MWR' | 'TWR';
type PeriodPreset = 'month' | 'ytd' | 'year' | 'custom';

type Point = { date: string; iso: string; yieldPct: number; netAssets: number };

function firstOfMonth(d = new Date()) {
	return new Date(d.getFullYear(), d.getMonth(), 1);
}

function janFirst(d = new Date()) {
	return new Date(d.getFullYear(), 0, 1);
}

// No mock data; page renders empty until API returns

export default function PortfolioReturnsPage() {
	const { currency } = useCurrencySwitch(true);
	const [mode, setMode] = useState<Mode>('MWR');
	const [seriesShown, setSeriesShown] = useState<string[]>(['yield', 'net']);
	const [preset, setPreset] = useState<PeriodPreset>('month');
	const [customRange, setCustomRange] = useState<DateRange | undefined>();

	const now = new Date();
	const range = useMemo(() => {
		switch (preset) {
			case 'month':
				return { from: firstOfMonth(now), to: now } as DateRange;
			case 'ytd':
				return { from: janFirst(now), to: now } as DateRange;
			case 'year': {
				const from = new Date(now);
				from.setFullYear(now.getFullYear() - 1);
				return { from, to: now } as DateRange;
			}
			case 'custom':
				return customRange ?? { from: janFirst(now), to: now };
		}
	}, [preset, customRange]);

	const isoFrom = useMemo(() => {
		const d = range.from ?? janFirst(now);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}, [range.from]);
	const isoTo = useMemo(() => {
		const d = range.to ?? now;
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}, [range.to]);

	const perfQuery = api.portfolio.performance.useQuery(
		{ currency: currency as Currency, from: isoFrom, to: isoTo },
		{ refetchOnWindowFocus: false, staleTime: 60_000 }
	);

	const points: Point[] = useMemo(() => {
		if (!perfQuery.isSuccess || perfQuery.data.points.length === 0) return [];
		return perfQuery.data.points.map((p) => {
			const date = new Date(p.date);
			const formattedDate = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
			return {
				date: formattedDate,
				iso: p.date,
				netAssets: p.netAssets,
				yieldPct: mode === 'TWR' ? p.yieldTwr : p.yieldMwr
			};
		});
	}, [perfQuery.isSuccess, perfQuery.data?.points, mode]);

	const totalReturn: number | null = useMemo(() => {
		if (!perfQuery.isSuccess) return null;
		return mode === 'TWR' ? perfQuery.data.totalReturnTwr : perfQuery.data.totalReturnMwr;
	}, [perfQuery.isSuccess, perfQuery.data, mode]);

	const prevDayReturn: number | null = useMemo(() => {
		if (!perfQuery.isSuccess) return null;
		return mode === 'TWR' ? perfQuery.data.prevDayReturnTwr : perfQuery.data.prevDayReturnMwr;
	}, [perfQuery.isSuccess, perfQuery.data, mode]);

	const chartData = useMemo(
		() => points.map((p) => ({ date: p.date, net: p.netAssets, yield: p.yieldPct })),
		[points]
	);

	const chartConfig = {
		net: { color: 'var(--chart-2)', label: 'Net assets' },
		yield: { color: 'var(--chart-1)', label: 'Yield' }
	} as const;

	function pct(n: number) {
		return `${n.toFixed(2)}%`;
	}

	return (
		<div className='space-y-4'>
			<h1 className='text-2xl font-semibold tracking-tight'>Return Analysis</h1>

			<Card>
				<CardHeader className='gap-4 md:flex-row md:items-center md:justify-between'>
					<div>
						<CardTitle>Portfolio performance</CardTitle>
						<CardDescription>View performance as money-weighted or time-weighted returns.</CardDescription>
					</div>
					<div className='flex flex-wrap items-center gap-2' data-testid='controls-row'>
						<ToggleGroup
							aria-label='Return mode'
							data-testid='mode-toggle'
							onValueChange={(v) => v && setMode(v as Mode)}
							type='single'
							value={mode}
						>
							<ToggleGroupItem aria-label='MWR' value='MWR'>
								MWR
							</ToggleGroupItem>
							<ToggleGroupItem aria-label='TWR' value='TWR'>
								TWR
							</ToggleGroupItem>
						</ToggleGroup>

						<ToggleGroup
							aria-label='Series shown'
							data-testid='series-toggle'
							onValueChange={(v) => v.length && setSeriesShown(v)}
							type='multiple'
							value={seriesShown}
						>
							<ToggleGroupItem aria-label='Yield' value='yield'>
								Yield
							</ToggleGroupItem>
							<ToggleGroupItem aria-label='Net assets' value='net'>
								Net assets
							</ToggleGroupItem>
						</ToggleGroup>

						<Select
							data-testid='period-select'
							onValueChange={(v) => setPreset(v as PeriodPreset)}
							value={preset}
						>
							<SelectTrigger className='w-[160px]'>
								<SelectValue placeholder='Period' />
							</SelectTrigger>
							<SelectContent align='end'>
								<SelectItem value='month'>Month</SelectItem>
								<SelectItem value='ytd'>Year-to-date</SelectItem>
								<SelectItem value='year'>Past year</SelectItem>
								<SelectItem value='custom'>Custom…</SelectItem>
							</SelectContent>
						</Select>

						<Popover>
							<PopoverTrigger asChild>
								<Button
									aria-label='Period selection'
									className={cn(
										'w-[220px] justify-start',
										preset !== 'custom' && 'text-muted-foreground'
									)}
									data-testid='period-picker-button'
									variant='outline'
								>
									{preset === 'custom' && range.from && range.to
										? `${range.from.toLocaleDateString()} – ${range.to.toLocaleDateString()}`
										: 'Period selection'}
								</Button>
							</PopoverTrigger>
							<PopoverContent align='end' className='w-auto p-0'>
								<Calendar
									initialFocus
									mode='range'
									numberOfMonths={2}
									onSelect={(r) => {
										setPreset('custom');
										setCustomRange(r);
									}}
									selected={range}
								/>
							</PopoverContent>
						</Popover>
					</div>
				</CardHeader>
				<CardContent>
					{chartData.length === 0 ? (
						<div className='flex h-[380px] items-center justify-center text-muted-foreground'>
							No data for selected period
						</div>
					) : (
						<ChartContainer className='aspect-[16/7]' config={chartConfig}>
							<ResponsiveContainer>
								<LineChart data={chartData} margin={{ bottom: 0, left: 8, right: 8, top: 8 }}>
									<CartesianGrid strokeDasharray='3 3' />
									<XAxis axisLine={false} dataKey='date' minTickGap={24} tickLine={false} />
									<YAxis
										axisLine={false}
										dataKey='yield'
										tickFormatter={(n) => pct(Number(n))}
										tickLine={false}
										width={48}
										yAxisId='left'
									/>
									<YAxis
										axisLine={false}
										dataKey='net'
										orientation='right'
										tickFormatter={(n) => formatCurrency(Number(n), currency as Currency, 0)}
										tickLine={false}
										width={72}
										yAxisId='right'
									/>
									<Tooltip
										content={
											<ChartTooltipContent
												formatter={(value, name) => {
													if (name === 'yield') return [pct(Number(value)), ' Yield'] as any;
													return [
														formatCurrency(Number(value), currency as Currency, 0),
														' Net assets'
													] as any;
												}}
											/>
										}
									/>
									<Legend content={<ChartLegendContent />} />
									{seriesShown.includes('yield') && (
										<Line
											activeDot={{
												fill: 'var(--color-yield)',
												r: 4,
												stroke: 'var(--background)',
												strokeWidth: 1
											}}
											connectNulls
											dataKey='yield'
											dot={false}
											name='yield'
											stroke='var(--color-yield)'
											strokeWidth={2}
											type='monotone'
											yAxisId='left'
										/>
									)}
									{seriesShown.includes('net') && (
										<Line
											activeDot={{
												fill: 'var(--color-net)',
												r: 4,
												stroke: 'var(--background)',
												strokeWidth: 1
											}}
											connectNulls
											dataKey='net'
											dot={false}
											name='net'
											stroke='var(--color-net)'
											strokeWidth={2}
											type='monotone'
											yAxisId='right'
										/>
									)}
								</LineChart>
							</ResponsiveContainer>
						</ChartContainer>
					)}
				</CardContent>
			</Card>

			<div className='grid gap-4 md:grid-cols-2'>
				<Card data-testid='total-return-card'>
					<CardHeader>
						<CardTitle>Total return</CardTitle>
						<CardDescription>For the selected period</CardDescription>
					</CardHeader>
					<CardContent>
						{totalReturn == null ? (
							<Skeleton className='h-9 w-28' />
						) : (
							<div
								className={cn(
									'text-3xl font-semibold',
									totalReturn >= 0 ? 'text-emerald-500' : 'text-red-500'
								)}
							>
								{totalReturn >= 0 ? '+' : ''}
								{totalReturn.toFixed(2)}%
							</div>
						)}
					</CardContent>
				</Card>
				<Card data-testid='prev-day-return-card'>
					<CardHeader>
						<CardTitle>Previous day</CardTitle>
						<CardDescription>Day-over-day portfolio return</CardDescription>
					</CardHeader>
					<CardContent>
						{prevDayReturn == null ? (
							<Skeleton className='h-9 w-28' />
						) : (
							<div
								className={cn(
									'text-3xl font-semibold',
									prevDayReturn >= 0 ? 'text-emerald-500' : 'text-red-500'
								)}
							>
								{prevDayReturn >= 0 ? '+' : ''}
								{prevDayReturn.toFixed(2)}%
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

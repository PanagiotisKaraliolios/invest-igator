"use client";

import * as React from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';

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
import { Switch } from '@/components/ui/switch';
import { api } from '@/trpc/react';

type CombinedDatum = {
	date: string;
	// dynamic keys per symbol
	[cssKey: string]: string | number;
};

type SeriesDatum = { date: string; value: number };

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

export default function WatchlistCharts() {
	const { data: items } = api.watchlist.list.useQuery();
	const watchlistSymbols = items?.map((i) => i.symbol) ?? [];
	const symbols = (watchlistSymbols.length ? watchlistSymbols : ['AAPL', 'MSFT', 'GOOGL']).slice(0, 6);

	const [combined, setCombined] = React.useState(true);

	// Build stable CSS keys for symbols (used for ChartContainer color mapping and gradient IDs)
	const cssKeys = React.useMemo(() => symbols.map((s) => toCssKey(s)), [symbols]);

	// Build chart config mapping cssKey -> color token and display label
	const chartConfig: ChartConfig = React.useMemo(() => {
		const cfg: ChartConfig = {};
		cssKeys.forEach((cssKey, idx) => {
			cfg[cssKey] = { label: symbols[idx]!, color: colorTokens[idx % colorTokens.length] };
		});
		return cfg;
	}, [cssKeys, symbols]);

	// Build combined dataset: one row per date with keys for each symbol
	const combinedData: CombinedDatum[] = React.useMemo(() => {
		const per = symbols.map((s, idx) => ({ cssKey: cssKeys[idx]!, data: generateSeries(s) }));
		if (per.length === 0) return [];
		const byIndex: CombinedDatum[] = [];
		const len = per[0]!.data.length;
		for (let i = 0; i < len; i++) {
			const row: CombinedDatum = { date: per[0]!.data[i]!.date };
			per.forEach(({ cssKey, data }) => {
				row[cssKey] = data[i]?.value ?? 0;
			});
			byIndex.push(row);
		}
		return byIndex;
	}, [symbols, cssKeys]);

	const toId = React.useCallback((sym: string) => sym.replace(/[^a-zA-Z0-9_-]/g, '_'), []);

	return (
		<Card>
			<CardHeader className='flex flex-row items-center justify-between space-y-0'>
				<CardTitle>Charts</CardTitle>
				<div className='flex items-center gap-2'>
					<Label htmlFor='combined-chart'>Combined</Label>
					<Switch checked={combined} id='combined-chart' onCheckedChange={setCombined} />
				</div>
			</CardHeader>
			<CardContent className='space-y-4'>
				{combined ? (
					<ChartContainer config={chartConfig} className="aspect-auto h-[220px] w-full sm:h-[260px]">
						<AreaChart data={combinedData} margin={{ top: 8, right: 16, left: 12, bottom: 8 }}>
							<defs>
								{cssKeys.map((cssKey) => (
									<linearGradient key={cssKey} id={`fill-${cssKey}`} x1="0" y1="0" x2="0" y2="1">
										<stop offset="5%" stopColor={`var(--color-${cssKey})`} stopOpacity={0.8} />
										<stop offset="95%" stopColor={`var(--color-${cssKey})`} stopOpacity={0.1} />
									</linearGradient>
								))}
							</defs>
							<CartesianGrid vertical={false} />
							<XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} />
							<YAxis tickLine={false} axisLine={false} width={40} />
							<ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
							{cssKeys.map((cssKey) => (
								<Area
									key={cssKey}
									dataKey={cssKey}
									type="natural"
									fill={`url(#fill-${cssKey})`}
									stroke={`var(--color-${cssKey})`}
									strokeWidth={2}
									stackId="a"
								/>
							))}
							<ChartLegend content={<ChartLegendContent />} />
						</AreaChart>
					</ChartContainer>
				) : (
					<div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
						{symbols.map((sym, idx) => {
							const series = generateSeries(sym);
							const cssKey = cssKeys[idx]!;
							const cfg: ChartConfig = { [cssKey]: { label: sym, color: colorTokens[idx % colorTokens.length] } };
							const id = `fill-${cssKey}`;
							return (
								<div key={sym}>
									<ChartContainer config={cfg} className="aspect-auto h-[140px] w-full sm:h-[160px]">
									<AreaChart data={series} margin={{ top: 8, right: 16, left: 12, bottom: 8 }}>
										<defs>
										<linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
											<stop offset="5%" stopColor={`var(--color-${cssKey})`} stopOpacity={0.8} />
											<stop offset="95%" stopColor={`var(--color-${cssKey})`} stopOpacity={0.1} />
											</linearGradient>
										</defs>
										<CartesianGrid vertical={false} />
										<XAxis dataKey='date' tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} />
										<ChartTooltip content={<ChartTooltipContent nameKey={sym} indicator="dot" />} cursor={false} />
											<Area dataKey='value' type='natural' fill={`url(#${id})`} stroke={`var(--color-${cssKey})`} strokeWidth={2} stackId='a' />
										<ChartLegend content={<ChartLegendContent nameKey={sym} />} />
									</AreaChart>
									</ChartContainer>
									<div className="mt-1 text-center text-xs text-muted-foreground">{sym}</div>
								</div>
							);
						})}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

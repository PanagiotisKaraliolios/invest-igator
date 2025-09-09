'use client';

import * as React from 'react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

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
	[symbol: string]: string | number;
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

const palette = [
	'#2563eb', // blue-600
	'#10b981', // emerald-500
	'#f59e0b', // amber-500
	'#ef4444', // red-500
	'#8b5cf6', // violet-500
	'#22c55e', // green-500
	'#eab308', // yellow-500
	'#ec4899', // pink-500
	'#06b6d4', // cyan-500
	'#f97316', // orange-500
	'#84cc16', // lime-500
	'#a855f7', // purple-500
];

export default function WatchlistCharts() {
	const { data: items } = api.watchlist.list.useQuery();
	const watchlistSymbols = items?.map((i) => i.symbol) ?? [];
	const symbols = (watchlistSymbols.length ? watchlistSymbols : ['AAPL', 'MSFT', 'GOOGL']).slice(0, 6);

	const [combined, setCombined] = React.useState(true);

	// Build chart config mapping symbol -> color and label
	const chartConfig: ChartConfig = React.useMemo(() => {
		const cfg: ChartConfig = {};
		symbols.forEach((sym) => {
			cfg[sym] = { label: sym };
		});
		return cfg;
	}, [symbols]);

	// Build combined dataset: one row per date with keys for each symbol
	const combinedData: CombinedDatum[] = React.useMemo(() => {
		const perSymbol = symbols.map((s) => ({ data: generateSeries(s), key: s }));
		if (perSymbol.length === 0) return [];
		const byIndex: CombinedDatum[] = [];
		const len = perSymbol[0]!.data.length;
		for (let i = 0; i < len; i++) {
			const row: CombinedDatum = { date: perSymbol[0]!.data[i]!.date };
			perSymbol.forEach(({ key, data }) => {
				row[key] = data[i]?.value ?? 0;
			});
			byIndex.push(row);
		}
		return byIndex;
	}, [symbols]);

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
					<ChartContainer config={chartConfig}>
						<LineChart data={combinedData} margin={{ bottom: 8, left: 12, right: 16, top: 8 }}>
							<CartesianGrid strokeDasharray='3 3' vertical={false} />
							<XAxis axisLine={false} dataKey='date' tickLine={false} />
							<YAxis axisLine={false} tickLine={false} width={40} />
							<ChartTooltip content={<ChartTooltipContent />} />
							{symbols.map((sym, idx) => (
								<Line
									dataKey={sym}
									dot={false}
									isAnimationActive={false}
									key={sym}
									stroke={palette[idx % palette.length]}
									strokeWidth={2}
									type='monotone'
								/>
							))}
							<ChartLegend content={<ChartLegendContent />} />
						</LineChart>
					</ChartContainer>
				) : (
					<div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
						{symbols.map((sym, idx) => {
							const series = generateSeries(sym);
							const cfg: ChartConfig = { [sym]: { label: sym } };
							return (
								<ChartContainer config={cfg} key={sym}>
									<LineChart data={series} margin={{ bottom: 8, left: 12, right: 16, top: 8 }}>
										<CartesianGrid strokeDasharray='3 3' vertical={false} />
										<XAxis axisLine={false} dataKey='date' tickLine={false} />
										<YAxis axisLine={false} tickLine={false} width={40} />
										<ChartTooltip content={<ChartTooltipContent nameKey={sym} />} />
										<Line
											dataKey='value'
											dot={false}
											isAnimationActive={false}
											name={sym}
											stroke={palette[idx % palette.length]}
											strokeWidth={2}
											type='monotone'
										/>
										<ChartLegend content={<ChartLegendContent nameKey={sym} />} />
									</LineChart>
								</ChartContainer>
							);
						})}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

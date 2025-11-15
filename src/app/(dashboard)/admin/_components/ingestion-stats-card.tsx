'use client';

import { Activity, Database, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/trpc/react';

export function IngestionStatsCard() {
	const { data, isLoading } = api.financialData.getIngestionStats.useQuery();

	if (isLoading) {
		return (
			<div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
				{Array.from({ length: 4 }).map((_, i) => (
					<Card key={i}>
						<CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
							<Skeleton className='h-4 w-24' />
							<Skeleton className='h-4 w-4' />
						</CardHeader>
						<CardContent>
							<Skeleton className='h-8 w-16' />
							<Skeleton className='mt-2 h-3 w-32' />
						</CardContent>
					</Card>
				))}
			</div>
		);
	}

	if (!data) return null;

	const coverageColor =
		data.coverage >= 80 ? 'text-green-600' : data.coverage >= 50 ? 'text-yellow-600' : 'text-red-600';

	return (
		<div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
			<Card>
				<CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
					<CardTitle className='text-sm font-medium'>Total Symbols</CardTitle>
					<Database className='text-muted-foreground h-4 w-4' />
				</CardHeader>
				<CardContent>
					<div className='text-2xl font-bold'>{data.totalSymbols}</div>
					<p className='text-muted-foreground text-xs'>Unique symbols in watchlists</p>
				</CardContent>
			</Card>

			<Card>
				<CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
					<CardTitle className='text-sm font-medium'>With OHLCV Data</CardTitle>
					<Activity className='text-muted-foreground h-4 w-4' />
				</CardHeader>
				<CardContent>
					<div className='text-2xl font-bold'>{data.symbolsWithData}</div>
					<p className='text-muted-foreground text-xs'>Symbols with historical data</p>
				</CardContent>
			</Card>

			<Card>
				<CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
					<CardTitle className='text-sm font-medium'>Data Coverage</CardTitle>
					{data.coverage >= 50 ? (
						<TrendingUp className='text-muted-foreground h-4 w-4' />
					) : (
						<TrendingDown className='text-muted-foreground h-4 w-4' />
					)}
				</CardHeader>
				<CardContent>
					<div className={`text-2xl font-bold ${coverageColor}`}>{data.coverage.toFixed(1)}%</div>
					<p className='text-muted-foreground text-xs'>
						{data.totalSymbols - data.symbolsWithData} symbols missing data
					</p>
				</CardContent>
			</Card>

			<Card>
				<CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
					<CardTitle className='text-sm font-medium'>Recent Fetches</CardTitle>
					<Activity className='text-muted-foreground h-4 w-4' />
				</CardHeader>
				<CardContent>
					<div className='text-2xl font-bold'>{data.recentFetches.length}</div>
					<p className='text-muted-foreground text-xs'>Manual fetches (last 10)</p>
				</CardContent>
			</Card>
		</div>
	);
}

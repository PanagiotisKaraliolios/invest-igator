'use client';

import { Clock, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/trpc/react';

type Currency = 'EUR' | 'USD' | 'GBP' | 'HKD' | 'CHF' | 'RUB';

export function FxRatesPanel() {
	const [baseFilter, setBaseFilter] = useState<Currency | undefined>();
	const [quoteFilter, setQuoteFilter] = useState<Currency | undefined>();

	const { data, isLoading } = api.financialData.getFxRates.useQuery({
		base: baseFilter,
		quote: quoteFilter
	});

	const rates = data?.rates ?? [];
	const stats = data?.stats;

	const getAgeColor = (fetchedAt: Date) => {
		const ageHours = (Date.now() - new Date(fetchedAt).getTime()) / (1000 * 60 * 60);
		if (ageHours < 24) return 'text-green-600';
		if (ageHours < 72) return 'text-yellow-600';
		return 'text-red-600';
	};

	const formatAge = (fetchedAt: Date) => {
		const ageMs = Date.now() - new Date(fetchedAt).getTime();
		const hours = Math.floor(ageMs / (1000 * 60 * 60));
		const days = Math.floor(hours / 24);

		if (days > 0) return `${days}d ${hours % 24}h ago`;
		if (hours > 0) return `${hours}h ago`;
		return 'Just now';
	};

	return (
		<div className='space-y-6'>
			{/* Stats Cards */}
			{stats && (
				<div className='grid gap-4 md:grid-cols-3'>
					<Card>
						<CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
							<CardTitle className='text-sm font-medium'>Total Rates</CardTitle>
							<TrendingUp className='text-muted-foreground h-4 w-4' />
						</CardHeader>
						<CardContent>
							<div className='text-2xl font-bold'>{stats.totalRates}</div>
							<p className='text-muted-foreground text-xs'>Currency pair rates</p>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
							<CardTitle className='text-sm font-medium'>Average Age</CardTitle>
							<Clock className='text-muted-foreground h-4 w-4' />
						</CardHeader>
						<CardContent>
							<div className='text-2xl font-bold'>{stats.averageAgeHours.toFixed(1)}h</div>
							<p className='text-muted-foreground text-xs'>Since last update</p>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
							<CardTitle className='text-sm font-medium'>Last Update</CardTitle>
							<TrendingDown className='text-muted-foreground h-4 w-4' />
						</CardHeader>
						<CardContent>
							<div className='text-lg font-bold'>
								{stats.recentUpdate ? formatAge(new Date(stats.recentUpdate)) : 'N/A'}
							</div>
							<p className='text-muted-foreground text-xs'>Most recent fetch</p>
						</CardContent>
					</Card>
				</div>
			)}

			{/* Filters */}
			<div className='flex flex-col gap-4 sm:flex-row'>
				<div className='flex-1'>
					<Select onValueChange={(v) => setBaseFilter(v as Currency)} value={baseFilter}>
						<SelectTrigger>
							<SelectValue placeholder='Filter by base currency' />
						</SelectTrigger>
						<SelectContent>
							<SelectItem onClick={() => setBaseFilter(undefined)} value='all'>
								All Base Currencies
							</SelectItem>
							<SelectItem value='USD'>USD</SelectItem>
							<SelectItem value='EUR'>EUR</SelectItem>
							<SelectItem value='GBP'>GBP</SelectItem>
							<SelectItem value='HKD'>HKD</SelectItem>
							<SelectItem value='CHF'>CHF</SelectItem>
							<SelectItem value='RUB'>RUB</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className='flex-1'>
					<Select onValueChange={(v) => setQuoteFilter(v as Currency)} value={quoteFilter}>
						<SelectTrigger>
							<SelectValue placeholder='Filter by quote currency' />
						</SelectTrigger>
						<SelectContent>
							<SelectItem onClick={() => setQuoteFilter(undefined)} value='all'>
								All Quote Currencies
							</SelectItem>
							<SelectItem value='USD'>USD</SelectItem>
							<SelectItem value='EUR'>EUR</SelectItem>
							<SelectItem value='GBP'>GBP</SelectItem>
							<SelectItem value='HKD'>HKD</SelectItem>
							<SelectItem value='CHF'>CHF</SelectItem>
							<SelectItem value='RUB'>RUB</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			{/* Rates Table */}
			<div className='rounded-md border'>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Base</TableHead>
							<TableHead>Quote</TableHead>
							<TableHead className='text-right'>Rate</TableHead>
							<TableHead>Last Updated</TableHead>
							<TableHead>Status</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading ? (
							Array.from({ length: 10 }).map((_, i) => (
								<TableRow key={i}>
									<TableCell>
										<Skeleton className='h-5 w-12' />
									</TableCell>
									<TableCell>
										<Skeleton className='h-5 w-12' />
									</TableCell>
									<TableCell>
										<Skeleton className='h-5 w-20' />
									</TableCell>
									<TableCell>
										<Skeleton className='h-5 w-24' />
									</TableCell>
									<TableCell>
										<Skeleton className='h-5 w-16' />
									</TableCell>
								</TableRow>
							))
						) : rates.length === 0 ? (
							<TableRow>
								<TableCell className='h-24 text-center' colSpan={5}>
									No FX rates found. Try adjusting your filters.
								</TableCell>
							</TableRow>
						) : (
							rates.map((rate) => {
								const ageColor = getAgeColor(rate.fetchedAt);
								const ageText = formatAge(rate.fetchedAt);
								return (
									<TableRow key={rate.id}>
										<TableCell className='font-medium'>{rate.base}</TableCell>
										<TableCell className='font-medium'>{rate.quote}</TableCell>
										<TableCell className='text-right font-mono'>{rate.rate.toFixed(6)}</TableCell>
										<TableCell className={ageColor}>{ageText}</TableCell>
										<TableCell>
											<Badge variant={ageColor.includes('green') ? 'default' : 'secondary'}>
												{ageColor.includes('green')
													? 'Fresh'
													: ageColor.includes('yellow')
														? 'Stale'
														: 'Old'}
											</Badge>
										</TableCell>
									</TableRow>
								);
							})
						)}
					</TableBody>
				</Table>
			</div>

			{data && (
				<div className='text-muted-foreground text-sm'>
					Showing {rates.length} of {stats?.totalRates ?? 0} FX rates
				</div>
			)}
		</div>
	);
}

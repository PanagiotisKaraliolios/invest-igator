'use client';

import { AlertCircle, CheckCircle, Search } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/trpc/react';

export function DataQualityPanel() {
	const [searchSymbol, setSearchSymbol] = useState('');
	const [dateRange, setDateRange] = useState<{ from: Date; to: Date } | undefined>();

	const { data, isLoading, refetch } = api.financialData.checkDataQuality.useQuery({
		endDate: dateRange?.to,
		limit: 50,
		startDate: dateRange?.from,
		symbol: searchSymbol || undefined
	});

	const results = data?.results ?? [];

	const handleDateRangeChange = (range: { from?: Date; to?: Date } | undefined) => {
		if (range?.from && range?.to) {
			setDateRange({ from: range.from, to: range.to });
		} else {
			setDateRange(undefined);
		}
	};

	return (
		<div className='space-y-4'>
			{/* Filters */}
			<div className='flex flex-col gap-4 sm:flex-row'>
				<div className='relative flex-1'>
					<Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
					<Input
						className='pl-9'
						onChange={(e) => setSearchSymbol(e.target.value)}
						placeholder='Search specific symbol...'
						value={searchSymbol}
					/>
				</div>
				<DateRangePicker
					onChange={handleDateRangeChange}
					placeholder='Select date range'
					strictMaxDate={true}
					value={dateRange}
				/>
				<Button disabled={isLoading} onClick={() => void refetch()}>
					Check Quality
				</Button>
			</div>

			{/* Results Table */}
			<div className='rounded-md border'>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Symbol</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className='text-right'>Data Points</TableHead>
							<TableHead className='text-right'>Users</TableHead>
							<TableHead>Error</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading ? (
							Array.from({ length: 10 }).map((_, i) => (
								<TableRow key={i}>
									<TableCell>
										<Skeleton className='h-5 w-20' />
									</TableCell>
									<TableCell>
										<Skeleton className='h-5 w-16' />
									</TableCell>
									<TableCell>
										<Skeleton className='h-5 w-12' />
									</TableCell>
									<TableCell>
										<Skeleton className='h-5 w-8' />
									</TableCell>
									<TableCell>
										<Skeleton className='h-5 w-32' />
									</TableCell>
								</TableRow>
							))
						) : results.length === 0 ? (
							<TableRow>
								<TableCell className='h-24 text-center' colSpan={5}>
									No results. Click &quot;Check Quality&quot; to analyze symbols.
								</TableCell>
							</TableRow>
						) : (
							results.map((result) => (
								<TableRow key={result.symbol}>
									<TableCell className='font-mono font-medium'>{result.symbol}</TableCell>
									<TableCell>
										{result.hasData ? (
											<div className='flex items-center gap-2 text-green-600'>
												<CheckCircle className='h-4 w-4' />
												<span className='text-sm'>Has Data</span>
											</div>
										) : (
											<div className='flex items-center gap-2 text-red-600'>
												<AlertCircle className='h-4 w-4' />
												<span className='text-sm'>Missing Data</span>
											</div>
										)}
									</TableCell>
									<TableCell className='text-right font-medium'>
										{result.dataPointCount.toLocaleString()}
									</TableCell>
									<TableCell className='text-right'>{result.userCount}</TableCell>
									<TableCell className='text-muted-foreground text-sm'>
										{'error' in result ? result.error : '—'}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			{data && (
				<div className='text-muted-foreground text-sm'>
					Checked {data.totalChecked} symbol{data.totalChecked !== 1 ? 's' : ''}
				</div>
			)}
		</div>
	);
}

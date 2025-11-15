'use client';

import { format, subDays, subMonths } from 'date-fns';
import { Activity, BarChart3, Database, Globe, Key, Smartphone, TrendingUp, Users, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { createDateRangePresets, DateRangePicker } from '@/components/ui/date-range-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/trpc/react';

type Period = 'daily' | 'weekly' | 'monthly';

const periodLabels = {
	daily: 'Daily',
	monthly: 'Monthly',
	weekly: 'Weekly'
};

export function AnalyticsDashboard() {
	const [period, setPeriod] = useState<Period>('daily');
	const [dateRange, setDateRange] = useState<DateRange | undefined>({
		from: subDays(new Date(), 30),
		to: new Date()
	});

	const datePresets = useMemo(
		() => [
			createDateRangePresets.last7Days(),
			createDateRangePresets.last30Days(),
			createDateRangePresets.last90Days(),
			createDateRangePresets.thisMonth(),
			createDateRangePresets.lastMonth(),
			createDateRangePresets.thisYear(),
			createDateRangePresets.lastYear()
		],
		[]
	);

	const { data, isLoading } = api.admin.getAnalytics.useQuery({
		endDate: dateRange?.to,
		period,
		startDate: dateRange?.from
	});

	// Chart configurations
	const userGrowthConfig: ChartConfig = {
		count: {
			color: 'hsl(var(--chart-1))',
			label: 'New Users'
		}
	};

	const sessionActivityConfig: ChartConfig = {
		count: {
			color: 'hsl(var(--chart-2))',
			label: 'Active Users'
		}
	};

	// Format data for charts
	const userGrowthData = useMemo(
		() =>
			data?.userGrowth.map((item) => ({
				count: item.count,
				date: format(
					new Date(item.period),
					period === 'daily' ? 'MMM dd' : period === 'weekly' ? 'MMM dd' : 'MMM yyyy'
				)
			})) ?? [],
		[data, period]
	);

	const sessionActivityData = useMemo(
		() =>
			data?.sessionActivity.map((item) => ({
				count: item.count,
				date: format(
					new Date(item.period),
					period === 'daily' ? 'MMM dd' : period === 'weekly' ? 'MMM dd' : 'MMM yyyy'
				)
			})) ?? [],
		[data, period]
	);

	// Calculate trends
	const userGrowthTrend = useMemo(() => {
		if (!userGrowthData || userGrowthData.length < 2) return 0;
		const recent = userGrowthData.slice(-7).reduce((sum, d) => sum + d.count, 0);
		const previous = userGrowthData.slice(-14, -7).reduce((sum, d) => sum + d.count, 0);
		if (previous === 0) return 100;
		return Math.round(((recent - previous) / previous) * 100);
	}, [userGrowthData]);

	const sessionTrend = useMemo(() => {
		if (!sessionActivityData || sessionActivityData.length < 2) return 0;
		const recent = sessionActivityData.slice(-7).reduce((sum, d) => sum + d.count, 0);
		const previous = sessionActivityData.slice(-14, -7).reduce((sum, d) => sum + d.count, 0);
		if (previous === 0) return 100;
		return Math.round(((recent - previous) / previous) * 100);
	}, [sessionActivityData]);

	if (isLoading) {
		return <AnalyticsLoadingSkeleton />;
	}

	return (
		<div className='space-y-4'>
			{/* Controls */}
			<div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
				<div className='flex items-center gap-2'>
					<Select onValueChange={(v) => setPeriod(v as Period)} value={period}>
						<SelectTrigger className='w-[140px]'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='daily'>Daily</SelectItem>
							<SelectItem value='weekly'>Weekly</SelectItem>
							<SelectItem value='monthly'>Monthly</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<DateRangePicker onChange={setDateRange} presets={datePresets} strictMaxDate={true} value={dateRange} />
			</div>

			{/* Key Metrics */}
			<div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
				<Card>
					<CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
						<CardTitle className='text-sm font-medium'>Total New Users</CardTitle>
						<Users className='h-4 w-4 text-muted-foreground' />
					</CardHeader>
					<CardContent>
						<div className='text-2xl font-bold'>
							{userGrowthData.reduce((sum, d) => sum + d.count, 0).toLocaleString()}
						</div>
						<div className='flex items-center gap-1 text-xs text-muted-foreground'>
							<TrendingUp
								className={`h-3 w-3 ${userGrowthTrend >= 0 ? 'text-green-500' : 'text-red-500'}`}
							/>
							<span className={userGrowthTrend >= 0 ? 'text-green-500' : 'text-red-500'}>
								{userGrowthTrend >= 0 ? '+' : ''}
								{userGrowthTrend}%
							</span>
							<span>vs previous period</span>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
						<CardTitle className='text-sm font-medium'>Active Sessions</CardTitle>
						<Activity className='h-4 w-4 text-muted-foreground' />
					</CardHeader>
					<CardContent>
						<div className='text-2xl font-bold'>
							{sessionActivityData.reduce((sum, d) => sum + d.count, 0).toLocaleString()}
						</div>
						<div className='flex items-center gap-1 text-xs text-muted-foreground'>
							<TrendingUp
								className={`h-3 w-3 ${sessionTrend >= 0 ? 'text-green-500' : 'text-red-500'}`}
							/>
							<span className={sessionTrend >= 0 ? 'text-green-500' : 'text-red-500'}>
								{sessionTrend >= 0 ? '+' : ''}
								{sessionTrend}%
							</span>
							<span>vs previous period</span>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
						<CardTitle className='text-sm font-medium'>Avg Session Duration</CardTitle>
						<BarChart3 className='h-4 w-4 text-muted-foreground' />
					</CardHeader>
					<CardContent>
						<div className='text-2xl font-bold'>
							{Math.round(data?.sessionStats.avgDurationMinutes ?? 0)} min
						</div>
						<p className='text-xs text-muted-foreground'>Average session length</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
						<CardTitle className='text-sm font-medium'>API Requests</CardTitle>
						<Key className='h-4 w-4 text-muted-foreground' />
					</CardHeader>
					<CardContent>
						<div className='text-2xl font-bold'>{data?.apiUsage.totalRequests.toLocaleString() ?? 0}</div>
						<p className='text-xs text-muted-foreground'>{data?.apiUsage.activeKeys ?? 0} active keys</p>
					</CardContent>
				</Card>
			</div>

			{/* Main Charts */}
			<Tabs className='space-y-4' defaultValue='growth'>
				<TabsList>
					<TabsTrigger value='growth'>User Growth</TabsTrigger>
					<TabsTrigger value='engagement'>Engagement</TabsTrigger>
					<TabsTrigger value='platform'>Platform Usage</TabsTrigger>
				</TabsList>

				<TabsContent className='space-y-4' value='growth'>
					<Card>
						<CardHeader>
							<CardTitle>User Growth Over Time</CardTitle>
							<CardDescription>
								New user signups by {periodLabels[period].toLowerCase()} period
							</CardDescription>
						</CardHeader>
						<CardContent>
							<ChartContainer className='h-[300px] w-full' config={userGrowthConfig}>
								<AreaChart data={userGrowthData} margin={{ bottom: 0, left: 12, right: 12, top: 12 }}>
									<defs>
										<linearGradient id='fillUserGrowth' x1='0' x2='0' y1='0' y2='1'>
											<stop offset='5%' stopColor='var(--chart-1)' stopOpacity={0.8} />
											<stop offset='95%' stopColor='var(--chart-1)' stopOpacity={0.1} />
										</linearGradient>
									</defs>
									<CartesianGrid strokeDasharray='3 3' vertical={false} />
									<XAxis
										axisLine={false}
										dataKey='date'
										minTickGap={32}
										tickLine={false}
										tickMargin={8}
									/>
									<YAxis axisLine={false} tickLine={false} tickMargin={8} />
									<ChartTooltip content={<ChartTooltipContent />} cursor={false} />
									<Area
										dataKey='count'
										fill='url(#fillUserGrowth)'
										fillOpacity={0.4}
										stroke='var(--chart-1)'
										strokeWidth={2}
										type='monotone'
									/>
								</AreaChart>
							</ChartContainer>
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent className='space-y-4' value='engagement'>
					<Card>
						<CardHeader>
							<CardTitle>Session Activity</CardTitle>
							<CardDescription>
								Active user sessions by {periodLabels[period].toLowerCase()} period
							</CardDescription>
						</CardHeader>
						<CardContent>
							<ChartContainer className='h-[300px] w-full' config={sessionActivityConfig}>
								<LineChart
									data={sessionActivityData}
									margin={{ bottom: 0, left: 12, right: 12, top: 12 }}
								>
									<CartesianGrid strokeDasharray='3 3' vertical={false} />
									<XAxis
										axisLine={false}
										dataKey='date'
										minTickGap={32}
										tickLine={false}
										tickMargin={8}
									/>
									<YAxis axisLine={false} tickLine={false} tickMargin={8} />
									<ChartTooltip content={<ChartTooltipContent />} />
									<Line
										dataKey='count'
										dot={false}
										stroke='var(--chart-2)'
										strokeWidth={2}
										type='monotone'
									/>
								</LineChart>
							</ChartContainer>
						</CardContent>
					</Card>

					<div className='grid gap-4 md:grid-cols-2'>
						<Card>
							<CardHeader>
								<CardTitle className='flex items-center gap-2'>
									<Globe className='h-5 w-5' />
									Geographic Distribution
								</CardTitle>
								<CardDescription>Top 10 locations by user sessions</CardDescription>
							</CardHeader>
							<CardContent>
								<div className='space-y-2'>
									{data?.geoDistribution.map((geo, index) => (
										<div className='flex items-center justify-between' key={geo.location}>
											<div className='flex items-center gap-2'>
												<Badge className='w-8 justify-center' variant='outline'>
													{index + 1}
												</Badge>
												<span className='text-sm'>{geo.location}</span>
											</div>
											<span className='text-sm font-medium'>{geo.count.toLocaleString()}</span>
										</div>
									))}
									{(!data?.geoDistribution || data.geoDistribution.length === 0) && (
										<p className='text-sm text-muted-foreground'>No location data available</p>
									)}
								</div>
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
								<CardTitle className='flex items-center gap-2'>
									<Smartphone className='h-5 w-5' />
									Device Distribution
								</CardTitle>
								<CardDescription>Sessions by device type</CardDescription>
							</CardHeader>
							<CardContent>
								<div className='space-y-2'>
									{data?.deviceDistribution.map((device, index) => (
										<div className='flex items-center justify-between' key={device.device}>
											<div className='flex items-center gap-2'>
												<Badge className='w-8 justify-center' variant='outline'>
													{index + 1}
												</Badge>
												<span className='text-sm'>{device.device}</span>
											</div>
											<span className='text-sm font-medium'>{device.count.toLocaleString()}</span>
										</div>
									))}
									{(!data?.deviceDistribution || data.deviceDistribution.length === 0) && (
										<p className='text-sm text-muted-foreground'>No device data available</p>
									)}
								</div>
							</CardContent>
						</Card>
					</div>
				</TabsContent>

				<TabsContent className='space-y-4' value='platform'>
					<div className='grid gap-4 md:grid-cols-2'>
						<Card>
							<CardHeader>
								<CardTitle>Most Viewed Symbols</CardTitle>
								<CardDescription>Top 10 symbols added to watchlists</CardDescription>
							</CardHeader>
							<CardContent>
								<div className='space-y-2'>
									{data?.popularSymbols.map((symbol, index) => (
										<div className='flex items-center justify-between' key={symbol.symbol}>
											<div className='flex items-center gap-2'>
												<Badge className='w-8 justify-center' variant='outline'>
													{index + 1}
												</Badge>
												<div className='flex flex-col'>
													<span className='text-sm font-medium'>{symbol.symbol}</span>
													{symbol.displaySymbol !== symbol.symbol && (
														<span className='text-xs text-muted-foreground'>
															{symbol.displaySymbol}
														</span>
													)}
												</div>
											</div>
											<span className='text-sm font-medium'>{symbol.count.toLocaleString()}</span>
										</div>
									))}
									{(!data?.popularSymbols || data.popularSymbols.length === 0) && (
										<p className='text-sm text-muted-foreground'>No symbol data available</p>
									)}
								</div>
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
								<CardTitle className='flex items-center gap-2'>
									<Wallet className='h-5 w-5' />
									API Usage Statistics
								</CardTitle>
								<CardDescription>Programmatic access metrics</CardDescription>
							</CardHeader>
							<CardContent>
								<div className='space-y-4'>
									<div className='flex items-center justify-between'>
										<span className='text-sm text-muted-foreground'>Total Requests</span>
										<span className='text-2xl font-bold'>
											{data?.apiUsage.totalRequests.toLocaleString() ?? 0}
										</span>
									</div>
									<div className='flex items-center justify-between'>
										<span className='text-sm text-muted-foreground'>Active API Keys</span>
										<span className='text-2xl font-bold'>{data?.apiUsage.activeKeys ?? 0}</span>
									</div>
									<div className='flex items-center justify-between'>
										<span className='text-sm text-muted-foreground'>Avg Requests per Key</span>
										<span className='text-2xl font-bold'>
											{Math.round(data?.apiUsage.avgRequestsPerKey ?? 0).toLocaleString()}
										</span>
									</div>
								</div>
							</CardContent>
						</Card>
					</div>
				</TabsContent>
			</Tabs>
		</div>
	);
}

function AnalyticsLoadingSkeleton() {
	return (
		<div className='space-y-4'>
			<div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
				<Skeleton className='h-10 w-[140px]' />
				<Skeleton className='h-10 w-[300px]' />
			</div>
			<div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
				{Array.from({ length: 4 }).map((_, i) => (
					<Card key={i}>
						<CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
							<Skeleton className='h-4 w-[100px]' />
							<Skeleton className='h-4 w-4' />
						</CardHeader>
						<CardContent>
							<Skeleton className='h-8 w-[120px]' />
							<Skeleton className='mt-2 h-3 w-[160px]' />
						</CardContent>
					</Card>
				))}
			</div>
			<Card>
				<CardHeader>
					<Skeleton className='h-6 w-[200px]' />
					<Skeleton className='mt-2 h-4 w-[300px]' />
				</CardHeader>
				<CardContent>
					<Skeleton className='h-[300px] w-full' />
				</CardContent>
			</Card>
		</div>
	);
}

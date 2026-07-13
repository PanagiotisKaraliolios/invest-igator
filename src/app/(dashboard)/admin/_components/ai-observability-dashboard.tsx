'use client';

import { AlertTriangle, Clock, Coins, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/trpc/react';

const RANGES = { '7': 'Last 7 days', '30': 'Last 30 days', '90': 'Last 90 days' } as const;

/** nanoUSD (1e-9 USD) -> a USD string. BigInt division, so nothing truncates on the way. */
function formatNanoUsd(nano: bigint): string {
	const negative = nano < 0n;
	const abs = negative ? -nano : nano;
	const whole = abs / 1_000_000_000n;
	const fraction = (abs % 1_000_000_000n) / 10_000n; // 5 decimal places
	const text = `$${whole.toString()}.${fraction.toString().padStart(5, '0')}`;
	return negative ? `-${text}` : text;
}

// Tailwind v4 + this repo's tokens: the chart vars are raw colours (`--chart-1: oklch(...)`),
// so the value is `var(--chart-1)`. `hsl(var(--chart-1))` produces an invalid colour and the
// bars render transparent. See src/app/(dashboard)/watchlist/_components/chart-utils.ts.
const toolChartConfig: ChartConfig = {
	calls: { color: 'var(--chart-1)', label: 'Calls' }
};

export function AiObservabilityDashboard() {
	const [range, setRange] = useState<keyof typeof RANGES>('30');
	const { data, isLoading } = api.aiObservability.overview.useQuery({ days: Number(range) });

	if (isLoading || !data) {
		return (
			<div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
				<Skeleton className='h-28 w-full' />
				<Skeleton className='h-28 w-full' />
				<Skeleton className='h-28 w-full' />
				<Skeleton className='h-28 w-full' />
			</div>
		);
	}

	return (
		<div className='space-y-4'>
			<div className='flex justify-end'>
				<Select items={RANGES} onValueChange={(value) => setRange(value as keyof typeof RANGES)} value={range}>
					<SelectTrigger className='w-44'>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{Object.entries(RANGES).map(([value, label]) => (
							<SelectItem key={value} value={value}>
								{label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
				<Card>
					<CardHeader className='pb-2'>
						<CardDescription className='flex items-center gap-2'>
							<Coins className='size-4' />
							Platform spend
						</CardDescription>
						<CardTitle className='text-2xl'>{formatNanoUsd(data.totals.platformNanoUsd)}</CardTitle>
					</CardHeader>
					<CardContent>
						<p className='text-muted-foreground text-xs'>What we paid. BYOK never lands here.</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className='pb-2'>
						<CardDescription className='flex items-center gap-2'>
							<Coins className='size-4' />
							BYOK spend
						</CardDescription>
						<CardTitle className='text-2xl'>{formatNanoUsd(data.totals.userNanoUsd)}</CardTitle>
					</CardHeader>
					<CardContent>
						<p className='text-muted-foreground text-xs'>Notional. Billed to the user&apos;s own key.</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className='pb-2'>
						<CardDescription className='flex items-center gap-2'>
							<Clock className='size-4' />
							Latency p50 / p95
						</CardDescription>
						<CardTitle className='text-2xl'>
							{data.latency.p50 === null ? '—' : `${Math.round(data.latency.p50)}ms`}
							{' / '}
							{data.latency.p95 === null ? '—' : `${Math.round(data.latency.p95)}ms`}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className='text-muted-foreground text-xs'>{data.totals.calls} provider calls</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className='pb-2'>
						<CardDescription className='flex items-center gap-2'>
							<AlertTriangle className='size-4' />
							Failure rate
						</CardDescription>
						<CardTitle className='text-2xl'>{(data.totals.failureRate * 100).toFixed(1)}%</CardTitle>
					</CardHeader>
					<CardContent>
						<div className='flex flex-wrap gap-1'>
							{data.outcomes.map((outcome) => (
								<Badge
									key={outcome.outcome}
									variant={outcome.outcome === 'OK' ? 'secondary' : 'destructive'}
								>
									{outcome.outcome} {outcome.count}
								</Badge>
							))}
						</div>
					</CardContent>
				</Card>
			</div>

			{data.totals.unpricedCalls > 0 ? (
				<Card className='border-destructive'>
					<CardHeader className='pb-2'>
						<CardTitle className='flex items-center gap-2 text-base'>
							<AlertTriangle className='size-4' />
							{data.totals.unpricedCalls} call(s) could not be priced
						</CardTitle>
						<CardDescription>
							The model is not in the vendored price snapshot, so cost is NULL — not zero. Real spend is
							higher than the figures above. Update the snapshot.
						</CardDescription>
					</CardHeader>
				</Card>
			) : null}

			<Card>
				<CardHeader>
					<CardTitle>Cost by model</CardTitle>
					<CardDescription>
						Grouped by the resolved model, not the deployment name — on Azure they are different strings.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Model</TableHead>
								<TableHead className='text-right'>Calls</TableHead>
								<TableHead className='text-right'>Tokens</TableHead>
								<TableHead className='text-right'>Cost</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data.byModel.length === 0 ? (
								<TableRow>
									<TableCell className='text-muted-foreground' colSpan={4}>
										No calls in this window.
									</TableCell>
								</TableRow>
							) : (
								data.byModel.map((model) => (
									<TableRow key={model.resolvedModel}>
										<TableCell className='font-medium'>{model.resolvedModel}</TableCell>
										<TableCell className='text-right'>{model.calls}</TableCell>
										<TableCell className='text-right'>
											{model.totalTokens.toLocaleString()}
										</TableCell>
										<TableCell className='text-right'>{formatNanoUsd(model.costNanoUsd)}</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className='flex items-center gap-2'>
						<Wrench className='size-4' />
						Tool-call frequency
					</CardTitle>
					<CardDescription>
						Which tools the model actually reaches for, and which of them fail.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{data.tools.length === 0 ? (
						<p className='text-muted-foreground text-sm'>No tool calls in this window.</p>
					) : (
						<>
							<ChartContainer className='h-56 w-full' config={toolChartConfig}>
								<BarChart data={data.tools}>
									<CartesianGrid vertical={false} />
									<XAxis axisLine={false} dataKey='toolName' tickLine={false} tickMargin={8} />
									<YAxis allowDecimals={false} axisLine={false} tickLine={false} />
									<ChartTooltip content={<ChartTooltipContent />} />
									<Bar dataKey='calls' fill='var(--color-calls)' radius={4} />
								</BarChart>
							</ChartContainer>
							<div className='mt-3 flex flex-wrap gap-2'>
								{data.tools
									.filter((tool) => tool.failures > 0)
									.map((tool) => (
										<Badge key={tool.toolName} variant='destructive'>
											{tool.toolName}: {tool.failures} failed
										</Badge>
									))}
							</div>
						</>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

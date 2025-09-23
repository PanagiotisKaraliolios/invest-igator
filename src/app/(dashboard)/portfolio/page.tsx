import { cookies } from 'next/headers';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type Currency, formatCurrency, supportedCurrencies } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { api } from '@/trpc/server';

export default async function PortfolioPage() {
	const jar = await cookies();
	const c = jar.get('ui-currency')?.value as Currency | undefined;
	const currency: Currency = c && (supportedCurrencies as readonly string[]).includes(c) ? c : 'USD';

	const now = new Date();
	const isoToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

	const [structure, perf] = await Promise.all([
		api.portfolio.structure({ currency }),
		api.portfolio.performance({ currency, from: '1900-01-01', to: isoToday })
	]);

	const totalValue = structure.totalValue;
	const totalCost = Array.isArray(structure.items)
		? structure.items.reduce((acc: number, i: any) => acc + (Number(i.totalCost) || 0), 0)
		: 0;
	const absPnl = totalValue - totalCost;
	const totalReturnPct = perf.totalReturnMwr; // inception-to-date, money-weighted
	const prevDayReturnPct = perf.prevDayReturnMwr;
	const lastTwoPoints = Array.isArray(perf.points) ? perf.points.slice(-2) : ([] as Array<{ netAssets?: number }>);
	const prevDayValueDelta =
		lastTwoPoints.length === 2
			? Number(lastTwoPoints[1]?.netAssets ?? 0) - Number(lastTwoPoints[0]?.netAssets ?? 0)
			: 0;
	const lastUpdatedLabel = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

	return (
		<div className='space-y-6'>
			<h1 className='text-2xl font-semibold tracking-tight'>Portfolio</h1>
			<div className={cn('grid gap-4', 'grid-cols-1 sm:grid-cols-2', 'items-stretch')}>
				<Link className='no-underline block h-full' href='/portfolio/structure'>
					<Card className='h-full transition-colors hover:bg-accent/40'>
						<CardHeader>
							<CardTitle>Portfolio Structure</CardTitle>
							<CardDescription>Allocation by symbol with pie and table.</CardDescription>
						</CardHeader>
						<CardContent>
							<div className='text-xs text-muted-foreground'>Total value</div>
							<div
								className='font-semibold text-2xl font-mono tabular-nums'
								data-testid='portfolio-total-value'
							>
								{formatCurrency(totalValue, currency, 0)}
							</div>
							<div
								className={cn(
									'mt-1 text-sm font-mono tabular-nums',
									prevDayValueDelta >= 0 ? 'text-emerald-600' : 'text-red-600'
								)}
								data-testid='portfolio-total-value-delta'
							>
								({prevDayValueDelta >= 0 ? '+' : '-'}
								{formatCurrency(Math.abs(prevDayValueDelta), currency, 0)} d/d)
							</div>
						</CardContent>
					</Card>
				</Link>

				<Link className='no-underline block h-full' href='/portfolio/returns'>
					<Card className='h-full transition-colors hover:bg-accent/40'>
						<CardHeader>
							<CardTitle>Return Analysis</CardTitle>
							<CardDescription>Performance over time.</CardDescription>
						</CardHeader>
						<CardContent>
							<div className='text-xs text-muted-foreground'>Total return (inception-to-date)</div>
							<div className='text-[11px] text-muted-foreground mt-1'>
								Based on {currency} • Updated {lastUpdatedLabel}
							</div>
							<div className='mt-1 flex items-baseline gap-2'>
								<div
									className={cn(
										'font-semibold text-2xl font-mono tabular-nums',
										totalReturnPct >= 0 ? 'text-emerald-600' : 'text-red-600'
									)}
								>
									<span data-testid='portfolio-itd-return'>
										{totalReturnPct >= 0 ? '+' : ''}
										{Number.isFinite(totalReturnPct) ? totalReturnPct.toFixed(2) : '—'}%
									</span>
								</div>
								<div
									className={cn(
										'text-sm font-mono tabular-nums',
										absPnl >= 0 ? 'text-emerald-600' : 'text-red-600'
									)}
									data-testid='portfolio-itd-pnl'
								>
									{absPnl >= 0 ? '+' : '-'}
									{formatCurrency(Math.abs(absPnl), currency, 0)}
								</div>
								<div
									className={cn(
										'text-sm font-mono tabular-nums',
										prevDayReturnPct >= 0 ? 'text-emerald-600' : 'text-red-600'
									)}
									data-testid='portfolio-prev-day-delta'
								>
									({prevDayReturnPct >= 0 ? '+' : ''}
									{Number.isFinite(prevDayReturnPct) ? prevDayReturnPct.toFixed(2) : '—'}% d/d)
								</div>
							</div>
						</CardContent>
					</Card>
				</Link>
			</div>
		</div>
	);
}

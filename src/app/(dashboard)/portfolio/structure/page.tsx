import { cookies } from 'next/headers';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type Currency, formatCurrency, supportedCurrencies } from '@/lib/currency';
import { api, HydrateClient } from '@/trpc/server';
import PieAllocation from './_components/pie-allocation';

export default async function PortfolioStructurePage() {
	const jar = await cookies();
	const c = jar.get('ui-currency')?.value as Currency | undefined;
	const currency: Currency = c && (supportedCurrencies as readonly string[]).includes(c) ? c : 'USD';
	const data = await api.portfolio.structure({ currency });

	// Prepare lightweight props for client pie component
	const slices = data.items.map((i: { symbol: string; weight: number }) => ({ symbol: i.symbol, weight: i.weight }));

	return (
		<HydrateClient>
			<div className='space-y-6'>
				<h1 className='text-2xl font-semibold tracking-tight'>Portfolio Structure</h1>

				<Card>
					<CardHeader>
						<CardTitle>Allocation by Symbol</CardTitle>
					</CardHeader>
					<CardContent>
						<div className='grid gap-6'>
							<div className='flex justify-center'>
								<PieAllocation currency={currency} items={slices} totalValue={data.totalValue} />
							</div>

							<div className='overflow-x-auto'>
								<table className='w-full text-sm'>
									<thead className='sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60'>
										<tr className='text-left'>
											<th className='px-2 py-2 font-medium'>Symbol</th>
											<th className='px-2 py-2 font-medium text-right'>Quantity</th>
											<th className='px-2 py-2 font-medium text-right'>Current Price</th>
											<th className='px-2 py-2 font-medium text-right'>Value</th>
											<th className='px-2 py-2 font-medium text-right'>Weight</th>
										</tr>
									</thead>
									<tbody className='[&>tr:nth-child(even)]:bg-muted/30'>
										{data.items.map(
											(row: {
												symbol: string;
												quantity: number;
												price: number;
												value: number;
												weight: number;
											}) => (
												<tr key={row.symbol}>
													<td className='px-2 py-2'>{row.symbol}</td>
													<td className='px-2 py-2 text-right font-mono tabular-nums'>
														{row.quantity.toLocaleString()}
													</td>
													<td className='px-2 py-2 text-right font-mono tabular-nums'>
														{formatCurrency(row.price, currency, 0)}
													</td>
													<td className='px-2 py-2 text-right font-mono tabular-nums'>
														{formatCurrency(row.value, currency, 0)}
													</td>
													<td className='px-2 py-2 text-right font-mono tabular-nums'>
														{(row.weight * 100).toFixed(2)}%
													</td>
												</tr>
											)
										)}
									</tbody>
								</table>
								{data.items.length === 0 && (
									<div className='text-muted-foreground py-8 text-center'>
										No holdings yet. Add transactions to see your structure.
									</div>
								)}
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		</HydrateClient>
	);
}

import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export default function PortfolioPage() {
	return (
		<div className='space-y-6'>
			<h1 className='text-2xl font-semibold tracking-tight'>Portfolio</h1>
			<div className={cn('grid gap-4', 'grid-cols-1 sm:grid-cols-2')}>
				<Link className='no-underline' href='/portfolio/structure'>
					<Card className='transition-colors hover:bg-accent/40'>
						<CardHeader>
							<CardTitle>Portfolio Structure</CardTitle>
							<CardDescription>Allocation by symbol with pie and table.</CardDescription>
						</CardHeader>
						<CardContent>
							<div className='text-muted-foreground text-sm'>See your current weights and values.</div>
						</CardContent>
					</Card>
				</Link>

				<Link className='no-underline' href='/portfolio/returns'>
					<Card className='transition-colors hover:bg-accent/40'>
						<CardHeader>
							<CardTitle>Return Analysis</CardTitle>
							<CardDescription>Performance over time (coming soon).</CardDescription>
						</CardHeader>
						<CardContent>
							<div className='text-muted-foreground text-sm'>
								Time-weighted and money-weighted returns.
							</div>
						</CardContent>
					</Card>
				</Link>
			</div>
		</div>
	);
}

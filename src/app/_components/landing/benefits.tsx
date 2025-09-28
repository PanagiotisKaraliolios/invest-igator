import { CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const benefits = [
	{
		body: 'See all holdings, cash flows, and performance metrics in one place without spreadsheets.',
		title: 'Unified Portfolio View'
	},
	{
		body: 'Money-weighted & time-weighted calculations with cash flow awareness and FX conversion.',
		title: 'Accurate Returns'
	},
	{
		body: 'Time-series powered by InfluxDB for responsive charts and historical analysis.',
		title: 'Fast Insights'
	},
	{
		body: 'Track symbols, prices and allocations to quickly spot movers and rebalance needs.',
		title: 'Watchlist Monitoring'
	},
	{
		body: 'Self-host friendly stack – control your data and deployment.',
		title: 'Data Ownership'
	},
	{
		body: 'Transparent codebase you can audit, extend, and trust.',
		title: 'Open Source'
	}
];

export function BenefitsSection() {
	return (
		<section className='container mx-auto px-6 py-16' data-testid='landing-benefits'>
			<div className='mx-auto mb-10 max-w-2xl text-center'>
				<h2 className='text-3xl font-semibold md:text-4xl'>Benefits that compound</h2>
				<p className='text-muted-foreground mt-3 text-balance'>
					Focused tooling that saves time and improves decision quality.
				</p>
			</div>
			<div className='grid gap-6 sm:grid-cols-2 lg:grid-cols-3'>
				{benefits.map((b) => (
					<Card className='relative overflow-hidden' key={b.title}>
						<CardHeader className='pb-2'>
							<CardTitle className='flex items-start gap-2 text-base font-semibold'>
								<CheckCircle2 className='mt-0.5 size-4 text-primary' /> {b.title}
							</CardTitle>
						</CardHeader>
						<CardContent className='pt-0 text-sm text-muted-foreground leading-relaxed'>
							{b.body}
						</CardContent>
					</Card>
				))}
			</div>
		</section>
	);
}

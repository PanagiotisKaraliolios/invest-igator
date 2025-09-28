import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const steps = [
	{ body: 'Import or manually add your historical buys & sells.', title: 'Add Transactions' },
	{ body: 'We compute TWR & MWR with FX and fees applied.', title: 'Track Performance' },
	{ body: 'Use structure & returns views to rebalance or allocate.', title: 'Act on Insights' }
];

export function HowItWorksSection() {
	return (
		<section className='container mx-auto px-6 py-16' data-testid='landing-how'>
			<div className='mx-auto mb-10 max-w-2xl text-center'>
				<h2 className='text-3xl font-semibold md:text-4xl'>How it works</h2>
				<p className='text-muted-foreground mt-3'>Three simple steps from raw data to clarity.</p>
			</div>
			<div className='grid gap-6 md:grid-cols-3'>
				{steps.map((s, i) => (
					<Card className='relative' key={s.title}>
						<CardHeader className='pb-2'>
							<span className='absolute right-4 top-4 text-5xl font-black text-primary/10'>{i + 1}</span>
							<CardTitle className='text-lg'>{s.title}</CardTitle>
						</CardHeader>
						<CardContent className='pt-0 text-sm text-muted-foreground leading-relaxed'>
							{s.body}
						</CardContent>
					</Card>
				))}
			</div>
		</section>
	);
}

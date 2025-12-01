'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGsap, useGsapStagger } from '@/hooks/use-gsap';
import { ArrowRight, Database, Gauge, ShieldCheck, Workflow } from 'lucide-react';

const pipeline = [
	{
		body: 'Yahoo Finance ingestion jobs pull OHLCV plus dividends, splits, and capital gains into InfluxDB while FX rates land in Postgres.',
		icon: Database,
		label: 'Collect & enrich',
		meta: 'Yahoo Finance • Alpha Vantage',
		title: 'Data you can trace'
	},
	{
		body: 'tRPC routers normalize transactions, apply FX, and compute time- and money-weighted returns with cash flow awareness.',
		icon: Gauge,
		label: 'Compute',
		meta: 'Prisma • tRPC v11',
		title: 'Deterministic math'
	},
	{
		body: 'Recharts, GSAP, and shadcn/ui render responsive watchlists, allocation structure, and performance timelines.',
		icon: Workflow,
		label: 'Visualize',
		meta: 'Recharts • GSAP',
		title: 'Visuals with intent'
	},
	{
		body: 'API keys with scopes, admin audit logs, and a self-host friendly Docker setup keep control on your side.',
		icon: ShieldCheck,
		label: 'Govern',
		meta: 'Better Auth • Audit logs',
		title: 'Secure operations'
	}
];

export function DataPipelineSection() {
	const headerRef = useGsap<HTMLDivElement>({ duration: 0.7, type: 'fadeUp' });
	const pipelineRef = useGsapStagger<HTMLDivElement>({ duration: 0.6, stagger: 0.1, type: 'fadeUp' });

	return (
		<section className='container mx-auto px-6 py-16 md:py-20' data-testid='landing-data-pipeline'>
			<div className='mx-auto mb-12 max-w-3xl text-center' ref={headerRef}>
				<Badge variant='outline' className='mb-3'>
					Under the hood
				</Badge>
				<h2 className='text-3xl font-semibold md:text-4xl'>A pipeline built for accuracy</h2>
				<p className='text-muted-foreground mt-3 text-balance'>
					From ingestion to visualization, every layer is typed, observable, and ready for audits.
				</p>
			</div>

			<div className='relative rounded-2xl border bg-card/60 p-4 sm:p-6 md:p-8' ref={pipelineRef}>
				<div className='pointer-events-none absolute inset-x-6 top-14 hidden h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent md:block' />
				<div className='grid gap-4 md:grid-cols-4'>
					{pipeline.map((step, index) => {
						const Icon = step.icon;
						return (
							<Card
								className='relative h-full border-border/60 bg-background/70 backdrop-blur'
								data-gsap-item
								key={step.title}
							>
								<CardHeader className='space-y-2 pb-3'>
									<div className='flex items-center justify-between'>
										<Badge variant='secondary'>{step.label}</Badge>
										<span className='grid size-9 place-items-center rounded-full bg-primary/10 text-primary'>
											<Icon className='size-4' />
										</span>
									</div>
									<CardTitle className='text-lg leading-tight'>{step.title}</CardTitle>
									<p className='text-xs text-muted-foreground uppercase tracking-wide'>{step.meta}</p>
								</CardHeader>
								<CardContent className='text-sm leading-relaxed text-muted-foreground'>
									<p>{step.body}</p>
									{index < pipeline.length - 1 ? (
										<div className='mt-4 flex items-center gap-2 text-xs font-medium text-primary'>
											<ArrowRight className='size-3.5' />
											<span>Feeds next stage</span>
										</div>
									) : null}
								</CardContent>
							</Card>
						);
					})}
				</div>
			</div>
		</section>
	);
}

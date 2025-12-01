'use client';

import { Gauge, LineChart, PlugZap, ServerCog, ShieldCheck, Table2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGsap, useGsapStagger } from '@/hooks/use-gsap';

const highlights = [
	{
		badge: 'Markets',
		body: 'InfluxDB-backed OHLCV with dividends and splits so every watchlist item stays contextual and date-aware.',
		icon: LineChart,
		points: [
			'Preset ranges with max-date constraints',
			'Event-aware pricing with FX normalization',
			'Interactive Recharts visuals'
		],
		title: 'Watchlists with real market context'
	},
	{
		badge: 'Portfolio math',
		body: 'Money-weighted and time-weighted returns that account for fees, FX, and intraperiod cash flows.',
		icon: Gauge,
		points: [
			'MWR + TWR via Modified Dietz',
			'Structure views for allocations and drift',
			'CSV import/export with duplicate detection'
		],
		title: 'Performance you can audit'
	},
	{
		badge: 'Data pipeline',
		body: 'Background jobs keep daily bars, FX rates, and corporate actions synced without manual CSV hunting.',
		icon: ServerCog,
		points: [
			'Yahoo Finance ingestion for bars + events',
			'Alpha Vantage FX cross-rates',
			'Per-symbol jobs when watchlists change'
		],
		title: 'Fresh data on autopilot'
	},
	{
		badge: 'Control',
		body: 'Self-host ready with API keys, scopes, and audit-friendly admin screens so you own your stack end-to-end.',
		icon: ShieldCheck,
		points: [
			'Granular API key scopes with rate limits',
			'Admin dashboards with user + audit logs',
			'Docker + env-based configuration'
		],
		title: 'Governance and self-hosting'
	},
	{
		badge: 'Ops',
		body: 'Prisma + PostgreSQL for relational data paired with InfluxDB for fast timeseries reads.',
		icon: Table2,
		points: ['tRPC v11 RSC + CSR hydration', 'Next.js 15 / React 19 frontend', 'shadcn/ui + GSAP animations'],
		title: 'Batteries-included stack'
	},
	{
		badge: 'Builders',
		body: 'Designed for extension—transparent code, open-source license, and predictable patterns across UI and API.',
		icon: PlugZap,
		points: [
			'Shared UI primitives and design tokens',
			'Typed hooks for server + client tRPC',
			'Docs, scripts, and tests to onboard faster'
		],
		title: 'Built to extend'
	}
];

export function FeatureShowcaseSection() {
	const headerRef = useGsap<HTMLDivElement>({ duration: 0.7, type: 'fadeUp' });
	const cardsRef = useGsapStagger<HTMLDivElement>({ duration: 0.6, stagger: 0.08, type: 'fadeUp' });

	return (
		<section className='container mx-auto px-6 py-16' data-testid='landing-feature-showcase' id='features'>
			<div className='mx-auto mb-12 max-w-3xl text-center' ref={headerRef}>
				<Badge className='mb-3' variant='outline'>
					Product tour
				</Badge>
				<h2 className='text-3xl font-semibold md:text-4xl'>More than a pretty dashboard</h2>
				<p className='text-muted-foreground mt-3 text-balance'>
					Dive deeper into how Invest-igator ingests, computes, and visualizes your portfolio with the same
					rigor you expect from spreadsheets—minus the maintenance.
				</p>
			</div>

			<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3' ref={cardsRef}>
				{highlights.map((item) => {
					const Icon = item.icon;
					return (
						<Card
							className='h-full border-border/60 bg-card/80 backdrop-blur transition-transform hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/5'
							data-gsap-item
							key={item.title}
						>
							<CardHeader className='space-y-2'>
								<div className='flex items-center justify-between'>
									<Badge variant='secondary'>{item.badge}</Badge>
									<span className='grid size-10 place-items-center rounded-full bg-primary/10 text-primary'>
										<Icon className='size-5' />
									</span>
								</div>
								<CardTitle className='text-lg leading-tight'>{item.title}</CardTitle>
							</CardHeader>
							<CardContent className='space-y-3 text-sm text-muted-foreground'>
								<p>{item.body}</p>
								<ul className='space-y-2'>
									{item.points.map((point) => (
										<li className='flex gap-2 items-center' key={point}>
											<span
												aria-hidden
												className='mt-0.5 h-1.5 w-1.5 rounded-full bg-primary/70'
											/>
											<span className='leading-relaxed'>{point}</span>
										</li>
									))}
								</ul>
							</CardContent>
						</Card>
					);
				})}
			</div>
		</section>
	);
}

'use client';

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight, Database, Gauge, ShieldCheck, Workflow } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGsap, useGsapStagger } from '@/hooks/use-gsap';

gsap.registerPlugin(ScrollTrigger);

function AnimatedBeam() {
	const beamRef = useRef<HTMLDivElement>(null);
	const glowRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!beamRef.current || !glowRef.current) return;

		const ctx = gsap.context(() => {
			// Main beam animation - travels across the pipeline
			gsap.fromTo(
				beamRef.current,
				{ left: '-80px', opacity: 0 },
				{
					duration: 2.5,
					ease: 'power1.inOut',
					left: 'calc(100% + 80px)',
					opacity: 1,
					repeat: -1,
					repeatDelay: 1.5,
					scrollTrigger: {
						start: 'top 80%',
						toggleActions: 'play pause resume pause',
						trigger: beamRef.current?.parentElement
					}
				}
			);

			// Glow pulse effect
			gsap.to(glowRef.current, {
				duration: 0.8,
				ease: 'power2.inOut',
				opacity: 0.8,
				repeat: -1,
				scale: 1.3,
				yoyo: true
			});
		});

		return () => ctx.revert();
	}, []);

	return (
		<div className='pointer-events-none absolute bottom-12 left-4 right-4 hidden h-8 overflow-hidden sm:left-6 sm:right-6 md:block md:left-8 md:right-8'>
			{/* Track line - the path the beam follows */}
			<div className='absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-primary/20 via-primary/40 to-primary/20' />
			
			{/* Track glow background */}
			<div className='absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-primary/10 blur-sm' />

			{/* Animated beam */}
			<div className='absolute top-1/2 -translate-y-1/2' ref={beamRef} style={{ width: '100px' }}>
				{/* Large glow effect */}
				<div
					className='absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/30 blur-xl'
					ref={glowRef}
				/>
				{/* Medium glow */}
				<div className='absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/50 blur-md' />
				{/* Beam trail gradient */}
				<div className='h-0.5 w-full rounded-full bg-gradient-to-r from-transparent via-primary to-primary' />
				{/* Leading dot with glow */}
				<div className='absolute right-0 top-1/2 size-2.5 -translate-y-1/2 translate-x-1/2 rounded-full bg-primary shadow-[0_0_12px_3px] shadow-primary/60' />
				{/* Inner bright core */}
				<div className='absolute right-0 top-1/2 size-1.5 -translate-y-1/2 translate-x-1/2 rounded-full bg-white' />
			</div>
		</div>
	);
}

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
				<Badge className='mb-3' variant='outline'>
					Under the hood
				</Badge>
				<h2 className='text-3xl font-semibold md:text-4xl'>A pipeline built for accuracy</h2>
				<p className='text-muted-foreground mt-3 text-balance'>
					From ingestion to visualization, every layer is typed, observable, and ready for audits.
				</p>
			</div>

			<div className='relative overflow-hidden rounded-2xl border bg-card/60 p-4 pb-16 sm:p-6 sm:pb-20 md:p-8 md:pb-24' ref={pipelineRef}>
				{/* Animated beam showing data flow */}
				<AnimatedBeam />

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

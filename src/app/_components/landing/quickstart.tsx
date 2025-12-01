'use client';

import { BookOpenCheck, PlayCircle, Server } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGsap, useGsapStagger } from '@/hooks/use-gsap';

const hostedSteps = [
	'Sign up and create your first watchlist',
	'Import transactions or add a few manual buys',
	'Preview performance and allocations instantly'
];

const selfHostCommands = `bun install
./start-database.sh
bun run db:generate
bun run dev`;

export function QuickstartSection() {
	const headerRef = useGsap<HTMLDivElement>({ duration: 0.7, type: 'fadeUp' });
	const cardsRef = useGsapStagger<HTMLDivElement>({ duration: 0.6, stagger: 0.12, type: 'fadeUp' });

	return (
		<section className='container mx-auto px-6 py-16 md:py-20' data-testid='landing-quickstart' id='quickstart'>
			<div className='mx-auto mb-12 max-w-3xl text-center' ref={headerRef}>
				<Badge className='mb-3' variant='outline'>
					Up and running
				</Badge>
				<h2 className='text-3xl font-semibold md:text-4xl'>Start in minutes</h2>
				<p className='text-muted-foreground mt-3 text-balance'>
					Choose the path that fits you today—hosted onboarding for instant insight or self-host for full
					control.
				</p>
			</div>

			<div className='grid gap-4 md:grid-cols-3' ref={cardsRef}>
				<Card
					className='h-full border-border/60 bg-card/80 backdrop-blur transition-transform hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/5 md:col-span-2'
					data-gsap-item
				>
					<CardHeader className='flex flex-row items-center justify-between'>
						<div>
							<CardTitle className='text-lg'>Hosted onboarding</CardTitle>
							<p className='text-sm text-muted-foreground'>
								Best for getting a portfolio live right now.
							</p>
						</div>
						<span className='grid size-10 place-items-center rounded-full bg-primary/10 text-primary'>
							<PlayCircle className='size-5' />
						</span>
					</CardHeader>
					<CardContent>
						<ol className='space-y-2 text-sm text-muted-foreground'>
							{hostedSteps.map((step, idx) => (
								<li className='flex items-start gap-2' key={step}>
									<span className='mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary'>
										{idx + 1}
									</span>
									<span className='leading-relaxed'>{step}</span>
								</li>
							))}
						</ol>
						<div className='mt-4 flex flex-wrap gap-3'>
							<Button asChild className='transition-transform hover:scale-105' size='sm'>
								<a href='/signup'>Create account</a>
							</Button>
							<Button
								asChild
								className='transition-transform hover:scale-105'
								size='sm'
								variant='outline'
							>
								<a href='/login'>Log in</a>
							</Button>
						</div>
					</CardContent>
				</Card>

				<Card
					className='h-full border-border/60 bg-background/80 backdrop-blur transition-transform hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/5'
					data-gsap-item
				>
					<CardHeader className='flex items-center justify-between'>
						<div>
							<CardTitle className='text-lg'>Self-host</CardTitle>
							<p className='text-sm text-muted-foreground'>Local dev setup with Postgres + Influx.</p>
						</div>
						<span className='grid size-10 place-items-center rounded-full bg-primary/10 text-primary'>
							<Server className='size-5' />
						</span>
					</CardHeader>
					<CardContent className='space-y-4'>
						<pre className='rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground'>
							<code>{selfHostCommands}</code>
						</pre>
						<div className='flex flex-wrap gap-2 text-[11px] uppercase tracking-wide text-muted-foreground'>
							<span className='rounded-full bg-primary/10 px-2 py-1 text-primary'>Bun</span>
							<span className='rounded-full bg-primary/10 px-2 py-1 text-primary'>Docker-friendly</span>
							<span className='rounded-full bg-primary/10 px-2 py-1 text-primary'>tRPC v11</span>
						</div>
						<Button asChild className='w-full' size='sm' variant='secondary'>
							<a
								href='https://github.com/PanagiotisKaraliolios/invest-igator'
								rel='noopener noreferrer'
								target='_blank'
							>
								<BookOpenCheck className='mr-2 size-4' />
								View README
							</a>
						</Button>
					</CardContent>
				</Card>
			</div>
		</section>
	);
}

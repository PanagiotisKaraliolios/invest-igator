'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGsap, useGsapStagger } from '@/hooks/use-gsap';
import { GitBranch, KeyRound, LockKeyhole, ShieldCheck, ShieldQuestion, Vault } from 'lucide-react';

const trustSignals = [
	{
		body: 'Better Auth with email/password, magic links, Discord, and optional 2FA. Sessions are role-aware by design.',
		icon: LockKeyhole,
		tag: 'Auth',
		title: 'Strong authentication'
	},
	{
		body: 'Granular API key scopes with expiration, rate limits, and SHA-256 storage keep programmatic access contained.',
		icon: KeyRound,
		tag: 'API',
		title: 'Scoped API keys'
	},
	{
		body: 'Admin dashboards surface user management, permissions, and audit logs so changes are reviewable.',
		icon: ShieldCheck,
		tag: 'Admin',
		title: 'Audit-ready controls'
	},
	{
		body: 'Open-source codebase with Docker + env-based configuration gives you portability and observability.',
		icon: GitBranch,
		tag: 'Ops',
		title: 'Transparent & portable'
	},
	{
		body: 'Postgres for relational data and InfluxDB for timeseries mean your data lives in infra you control.',
		icon: Vault,
		tag: 'Data',
		title: 'Data ownership'
	},
	{
		body: 'Clear documentation for deployment, environment variables, and ingestion jobs reduces unknowns.',
		icon: ShieldQuestion,
		tag: 'Docs',
		title: 'No surprises'
	}
];

export function TrustSignalsSection() {
	const headerRef = useGsap<HTMLDivElement>({ duration: 0.7, type: 'fadeUp' });
	const cardsRef = useGsapStagger<HTMLDivElement>({ duration: 0.6, stagger: 0.08, type: 'scaleUp' });

	return (
		<section className='container mx-auto px-6 py-16 md:py-20' data-testid='landing-trust' id='trust'>
			<div className='mx-auto mb-12 max-w-3xl text-center' ref={headerRef}>
				<Badge variant='outline' className='mb-3'>
					Trust & control
				</Badge>
				<h2 className='text-3xl font-semibold md:text-4xl'>Run it with confidence</h2>
				<p className='text-muted-foreground mt-3 text-balance'>
					Security defaults, transparent code, and operational guardrails so teams and solo investors can self-host
					or use the hosted app without hesitation.
				</p>
			</div>

			<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3' ref={cardsRef}>
				{trustSignals.map((item) => {
					const Icon = item.icon;
					return (
						<Card
							className='h-full border-border/60 bg-card/80 backdrop-blur transition-transform hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/5'
							data-gsap-item
							key={item.title}
						>
							<CardHeader className='space-y-2'>
								<div className='flex items-center justify-between'>
									<Badge variant='secondary'>{item.tag}</Badge>
									<span className='grid size-10 place-items-center rounded-full bg-primary/10 text-primary'>
										<Icon className='size-5' />
									</span>
								</div>
								<CardTitle className='text-lg leading-tight'>{item.title}</CardTitle>
							</CardHeader>
							<CardContent className='text-sm leading-relaxed text-muted-foreground'>{item.body}</CardContent>
						</Card>
					);
				})}
			</div>

			<div className='mt-10 flex flex-wrap items-center justify-center gap-3'>
				<Button asChild size='sm' variant='default'>
					<a href='/docs' target='_blank' rel='noopener noreferrer'>
						Read the docs
					</a>
				</Button>
				<Button asChild size='sm' variant='outline'>
					<a
						href='https://github.com/PanagiotisKaraliolios/invest-igator'
						target='_blank'
						rel='noopener noreferrer'
					>
						View the repo
					</a>
				</Button>
			</div>
		</section>
	);
}

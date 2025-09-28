import { Check } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

// Simple static pricing; adapt to env flags if needed.
const tiers = [
	{
		blurb: 'Track a personal portfolio',
		cta: 'Get started',
		features: ['Unlimited transactions', 'Watchlist', 'Basic charts', 'Open source'],
		href: '/signup',
		name: 'Starter',
		price: 'Free'
	},
	{
		blurb: 'Advanced insights & faster refresh',
		cta: 'Go Pro',
		features: ['Everything in Starter', 'Priority ingestion', 'Extended history', 'More export options'],
		highlight: true,
		href: '/signup',
		name: 'Pro',
		price: '$9/mo'
	},
	{
		blurb: 'Run it yourself – full control',
		cta: 'Docs',
		external: true,
		features: ['All features', 'Custom extensions', 'Own your data', 'Community support'],
		href: 'https://github.com/PanagiotisKaraliolios/invest-igator',
		name: 'Self-Host',
		price: 'Your infra'
	}
];

export function PricingSection({ signedIn }: { signedIn: boolean }) {
	return (
		<section className='container mx-auto px-6 py-16' data-testid='landing-pricing' id='pricing'>
			<div className='mx-auto mb-12 max-w-2xl text-center'>
				<h2 className='text-3xl font-semibold md:text-4xl'>Pricing</h2>
				<p className='text-muted-foreground mt-3'>Simple plans – upgrade only if you need more.</p>
			</div>
			<div className='grid gap-6 md:grid-cols-3'>
				{tiers.map((t) => (
					<Card className={t.highlight ? 'border-primary/60 shadow-lg shadow-primary/10' : ''} key={t.name}>
						<CardHeader>
							<CardTitle className='flex items-center justify-between text-xl'>
								{t.name}
								{t.highlight && (
									<span className='rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'>
										Popular
									</span>
								)}
							</CardTitle>
							<CardDescription>{t.blurb}</CardDescription>
						</CardHeader>
						<CardContent>
							<div className='mb-4 text-3xl font-semibold'>{t.price}</div>
							<ul className='space-y-2 text-sm'>
								{t.features.map((f) => (
									<li className='flex items-start gap-2' key={f}>
										<Check className='mt-0.5 size-4 text-primary' /> <span>{f}</span>
									</li>
								))}
							</ul>
						</CardContent>
						<CardFooter>
							<Button asChild size='sm' variant={t.highlight ? 'default' : 'outline'}>
								<Link
									href={t.href}
									rel={t.external ? 'noopener noreferrer' : undefined}
									target={t.external ? '_blank' : undefined}
								>
									{signedIn ? 'Manage' : t.cta}
								</Link>
							</Button>
						</CardFooter>
					</Card>
				))}
			</div>
		</section>
	);
}

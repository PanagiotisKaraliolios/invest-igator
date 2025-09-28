import { ChartLine, Github } from 'lucide-react';
import Link from 'next/link';
import { AdSlot } from '@/components/ads/AdSlot';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { env } from '@/env';
import { auth } from '@/server/auth';
import HeroCharts from './_components/hero-charts';
import { BenefitsSection } from './_components/landing/benefits';
import { FAQSection } from './_components/landing/faq';
import { HowItWorksSection } from './_components/landing/how-it-works';
import { PartnersRow } from './_components/landing/partners';
import { PricingSection } from './_components/landing/pricing';
import { TestimonialsSection } from './_components/landing/testimonials';
import ThemeSwitch from './(dashboard)/_components/theme-switch';

export const revalidate = 60;

export default async function Home() {
	const session = await auth();
	const appName = env.APP_NAME ?? 'Invest-igator';

	return (
		<main className='relative min-h-screen overflow-hidden bg-gradient-to-b from-background via-background to-background'>
			{/* Decorative glow */}
			<div className='pointer-events-none absolute inset-0 -z-10'>
				<div className='absolute left-1/2 top-[-10%] h-[40rem] w-[40rem] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]' />
			</div>

			{/* Header */}
			<header className='container mx-auto flex items-center justify-between px-6 py-6'>
				<Link className='flex items-center gap-2 text-foreground' href='/'>
					<span className='grid size-9 place-items-center rounded-md bg-primary/10 text-primary'>
						<ChartLine className='size-5' />
					</span>
					<span className='text-lg font-semibold'>{appName}</span>
				</Link>

				<nav className='flex items-center gap-2'>
					{session?.user ? (
						<>
							<Button asChild size='sm'>
								<Link href='/portfolio'>Open Portfolio</Link>
							</Button>
							<Button asChild size='sm' variant='ghost'>
								<Link href='/signout'>Sign out</Link>
							</Button>
						</>
					) : (
						<>
							<Button asChild size='sm' variant='ghost'>
								<Link href='/login'>Log in</Link>
							</Button>
							<Button asChild size='sm'>
								<Link href='/signup'>Get started</Link>
							</Button>
						</>
					)}
					<div className='mr-4 ml-auto'>
						<ThemeSwitch isAuthenticated={Boolean(session?.user)} />
					</div>
				</nav>
			</header>

			{/* Hero */}
			<section className='container mx-auto grid gap-8 px-6 py-10 md:grid-cols-2 md:items-center md:py-20'>
				<div className='flex flex-col gap-6'>
					<Badge className='w-fit' variant='secondary'>
						Open-source portfolio tracker
					</Badge>
					<h1 className='text-balance text-4xl font-semibold leading-tight tracking-tight md:text-6xl'>
						Track portfolios. Monitor watchlists. Visualize insights.
					</h1>
					<p className='text-muted-foreground text-lg leading-relaxed md:text-xl'>
						{appName} helps you aggregate holdings, analyze performance, and keep tabs on markets — powered
						by Next.js, tRPC, Prisma, and InfluxDB.
					</p>
					<div className='flex flex-wrap items-center gap-3'>
						{session?.user ? (
							<Button asChild size='lg'>
								<Link href='/portfolio'>Go to Portfolio</Link>
							</Button>
						) : (
							<>
								<Button asChild size='lg'>
									<Link href='/signup'>Create your account</Link>
								</Button>
								<Button asChild size='lg' variant='outline'>
									<Link href='/login'>I already have an account</Link>
								</Button>
							</>
						)}
					</div>
				</div>

				<div className='relative'>
					<div className='absolute -left-6 -top-6 h-24 w-24 rounded-full bg-primary/20 blur-2xl md:-left-10 md:-top-10' />
					<div className='absolute -bottom-6 -right-6 h-24 w-24 rounded-full bg-primary/10 blur-2xl md:-bottom-10 md:-right-10' />
					<div className='rounded-2xl border bg-card/50 p-1 shadow-2xl backdrop-blur'>
						<div className='rounded-xl bg-gradient-to-br from-primary/20 via-transparent to-transparent p-6'>
							<HeroCharts />
						</div>
					</div>
				</div>
			</section>

			{/* Partners / stack logos */}
			<PartnersRow />

			{/* Benefits grid */}
			<BenefitsSection />

			{/* How it works */}
			<HowItWorksSection />

			{/* Pricing */}
			<PricingSection signedIn={Boolean(session?.user)} />

			{/* Testimonials */}
			<TestimonialsSection />

			{/* FAQ */}
			<FAQSection />

			{/* Final CTA */}
			<section className='container mx-auto px-6 pb-16 md:pb-24' data-testid='landing-cta'>
				<div className='relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background p-8 md:p-12'>
					<div className='flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between'>
						<div>
							<h3 className='text-2xl font-semibold md:text-3xl'>Ready to build your edge?</h3>
							<p className='text-muted-foreground mt-2 max-w-xl'>
								Start in minutes. Import transactions, add watchlists, and visualize your portfolio.
							</p>
						</div>
						<div className='flex flex-wrap gap-3'>
							{session?.user ? (
								<Button asChild size='lg'>
									<Link href='/portfolio'>Open Portfolio</Link>
								</Button>
							) : (
								<>
									<Button asChild size='lg'>
										<Link href='/signup'>Get started free</Link>
									</Button>
									<Button asChild size='lg' variant='outline'>
										<Link href='/login'>Log in</Link>
									</Button>
								</>
							)}
						</div>
					</div>
				</div>
			</section>

			{/* Landing Ad */}
			{env.NEXT_PUBLIC_ADSENSE_SLOT_LANDING ? (
				<section className='container mx-auto px-6'>
					<AdSlot className='my-8' format='auto' slot={env.NEXT_PUBLIC_ADSENSE_SLOT_LANDING} />
				</section>
			) : null}

			{/* Footer */}
			<footer className='border-t'>
				<div className='container mx-auto px-6 py-12'>
					<div className='grid gap-8 md:grid-cols-4'>
						<div>
							<Link className='mb-3 flex items-center gap-2 text-foreground' href='/'>
								<span className='grid size-9 place-items-center rounded-md bg-primary/10 text-primary'>
									<ChartLine className='size-5' />
								</span>
								<span className='text-base font-semibold'>{appName}</span>
							</Link>
							<p className='text-muted-foreground text-sm'>
								Open-source portfolio tracker powered by Next.js, tRPC, Prisma, and InfluxDB.
							</p>
							<div className='mt-4 flex items-center gap-3'>
								<a
									aria-label='GitHub repository'
									className='text-muted-foreground hover:text-foreground'
									href='https://github.com/PanagiotisKaraliolios/invest-igator'
									rel='noopener noreferrer'
									target='_blank'
								>
									<Github className='size-5' />
								</a>
							</div>
						</div>

						<div>
							<h4 className='mb-3 text-sm font-semibold tracking-wide'>Product</h4>
							<ul className='space-y-2 text-sm text-muted-foreground'>
								<li>
									<Link className='hover:text-foreground' href='#features'>
										Features
									</Link>
								</li>
								<li>
									<Link className='hover:text-foreground' href='/watchlist'>
										Watchlist
									</Link>
								</li>
								<li>
									<Link className='hover:text-foreground' href='/portfolio'>
										Portfolio
									</Link>
								</li>
							</ul>
						</div>

						<div>
							<h4 className='mb-3 text-sm font-semibold tracking-wide'>Legal</h4>
							<ul className='space-y-2 text-sm text-muted-foreground'>
								<li>
									<Link className='hover:text-foreground' href='/privacy-policy'>
										Privacy Policy
									</Link>
								</li>
								<li>
									<Link className='hover:text-foreground' href='/terms-of-service'>
										Terms of Service
									</Link>
								</li>
							</ul>
						</div>

						<div>
							<h4 className='mb-3 text-sm font-semibold tracking-wide'>Account</h4>
							<ul className='space-y-2 text-sm text-muted-foreground'>
								<li>
									<Link className='hover:text-foreground' href='/login'>
										Login
									</Link>
								</li>
								<li>
									<Link className='hover:text-foreground' href='/signup'>
										Sign up
									</Link>
								</li>
							</ul>
						</div>
					</div>

					<div className='mt-10 flex flex-col items-center justify-between gap-4 border-t pt-6 text-sm text-muted-foreground md:flex-row'>
						<p>
							© {new Date().getFullYear()} {appName}. All rights reserved.
						</p>
					</div>
				</div>
			</footer>
		</main>
	);
}

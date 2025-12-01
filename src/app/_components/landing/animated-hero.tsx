'use client';

import { ChartLine } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useGsap, useGsapParallax } from '@/hooks/use-gsap';

interface AnimatedHeroProps {
	appName: string;
	isSignedIn: boolean;
	chartComponent: ReactNode;
}

export function AnimatedHero({ appName, isSignedIn, chartComponent }: AnimatedHeroProps) {
	const badgeRef = useGsap<HTMLDivElement>({ delay: 0.1, duration: 0.6, type: 'fadeDown' });
	const headlineRef = useGsap<HTMLHeadingElement>({ delay: 0.2, duration: 0.8, type: 'fadeUp' });
	const descRef = useGsap<HTMLParagraphElement>({ delay: 0.35, duration: 0.7, type: 'fadeUp' });
	const buttonsRef = useGsap<HTMLDivElement>({ delay: 0.5, duration: 0.6, type: 'fadeUp' });
	const chartRef = useGsap<HTMLDivElement>({ delay: 0.3, duration: 0.9, type: 'scaleUp' });
	const glowRef = useGsapParallax<HTMLDivElement>(0.3);

	return (
		<section className='container mx-auto grid gap-8 xl:gap-32 2xl:gap-56 px-6 py-10 md:grid-cols-2 md:items-center md:py-20'>
			<div className='flex flex-col gap-6'>
				<div ref={badgeRef}>
					<Badge className='w-fit' variant='secondary'>
						Open-source portfolio tracker
					</Badge>
				</div>
				<h1
					className='text-balance text-4xl font-semibold leading-tight tracking-tight md:text-6xl'
					ref={headlineRef}
				>
					Track portfolios. Monitor watchlists. Visualize insights.
				</h1>
				<p className='text-muted-foreground text-lg leading-relaxed md:text-xl' ref={descRef}>
					{appName} helps you aggregate holdings, analyze performance, and keep tabs on markets — powered by
					Next.js, tRPC, Prisma, and InfluxDB.
				</p>
				<div className='flex flex-wrap items-center gap-3' ref={buttonsRef}>
					{isSignedIn ? (
						<Button asChild size='lg'>
							<Link href='/portfolio'>Go to Portfolio</Link>
						</Button>
					) : (
						<>
							<Button asChild className='transition-transform hover:scale-105' size='lg'>
								<Link href='/signup'>Create your account</Link>
							</Button>
							<Button
								asChild
								className='transition-transform hover:scale-105'
								size='lg'
								variant='outline'
							>
								<Link href='/login'>I already have an account</Link>
							</Button>
						</>
					)}
				</div>
			</div>

			<div className='relative' ref={chartRef}>
				<div
					className='absolute -left-6 -top-6 h-24 w-24 rounded-full bg-primary/20 blur-2xl md:-left-10 md:-top-10'
					ref={glowRef}
				/>
				<div className='absolute -bottom-6 -right-6 h-24 w-24 rounded-full bg-primary/10 blur-2xl md:-bottom-10 md:-right-10' />
				<div className='rounded-2xl border bg-card/50 p-1 shadow-2xl backdrop-blur transition-transform hover:scale-[1.01]'>
					<div className='rounded-xl bg-gradient-to-br from-primary/20 via-transparent to-transparent p-6'>
						{chartComponent}
					</div>
				</div>
			</div>
		</section>
	);
}

export function AnimatedHeader({ appName, children }: { appName: string; children: ReactNode }) {
	const logoRef = useGsap<HTMLAnchorElement>({ duration: 0.6, type: 'fadeRight' });
	const navRef = useGsap<HTMLElement>({ duration: 0.6, type: 'fadeLeft' });

	return (
		<header className='container mx-auto flex items-center justify-between px-6 py-6'>
			<Link
				className='flex items-center gap-2 text-foreground transition-opacity hover:opacity-80'
				href='/'
				ref={logoRef}
			>
				<span className='grid size-9 place-items-center rounded-md bg-primary/10 text-primary'>
					<ChartLine className='size-5' />
				</span>
				<span className='text-lg font-semibold'>{appName}</span>
			</Link>

			<nav className='flex items-center gap-2' ref={navRef}>
				{children}
			</nav>
		</header>
	);
}

export function AnimatedCta({ isSignedIn }: { isSignedIn: boolean }) {
	const ctaRef = useGsap<HTMLDivElement>({ duration: 0.8, type: 'scaleUp' });

	return (
		<section className='container mx-auto px-6 pb-16 md:pb-24' data-testid='landing-cta'>
			<div
				className='relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background p-8 md:p-12 transition-shadow hover:shadow-xl hover:shadow-primary/5'
				ref={ctaRef}
			>
				<div className='flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between'>
					<div>
						<h3 className='text-2xl font-semibold md:text-3xl'>Ready to build your edge?</h3>
						<p className='text-muted-foreground mt-2 max-w-xl'>
							Start in minutes. Import transactions, add watchlists, and visualize your portfolio.
						</p>
					</div>
					<div className='flex flex-wrap gap-3'>
						{isSignedIn ? (
							<Button asChild className='transition-transform hover:scale-105' size='lg'>
								<Link href='/portfolio'>Open Portfolio</Link>
							</Button>
						) : (
							<>
								<Button asChild className='transition-transform hover:scale-105' size='lg'>
									<Link href='/signup'>Get started free</Link>
								</Button>
								<Button
									asChild
									className='transition-transform hover:scale-105'
									size='lg'
									variant='outline'
								>
									<Link href='/login'>Log in</Link>
								</Button>
							</>
						)}
					</div>
				</div>
			</div>
		</section>
	);
}

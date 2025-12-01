'use client';

import { ChartLine, Github } from 'lucide-react';
import Link from 'next/link';
import { useGsap, useGsapStagger } from '@/hooks/use-gsap';

interface AnimatedFooterProps {
	appName: string;
}

export function AnimatedFooter({ appName }: AnimatedFooterProps) {
	const footerRef = useGsap<HTMLElement>({ duration: 0.8, type: 'fadeUp' });
	const linksRef = useGsapStagger<HTMLDivElement>({ delay: 0.2, duration: 0.5, stagger: 0.1, type: 'fadeUp' });

	return (
		<footer className='border-t' ref={footerRef}>
			<div className='container mx-auto px-6 py-12'>
				<div className='grid gap-8 md:grid-cols-4' ref={linksRef}>
					<div data-gsap-item>
						<Link
							className='mb-3 flex items-center gap-2 text-foreground transition-opacity hover:opacity-80'
							href='/'
						>
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
								className='text-muted-foreground hover:text-foreground transition-colors'
								href='https://github.com/PanagiotisKaraliolios/invest-igator'
								rel='noopener noreferrer'
								target='_blank'
							>
								<Github className='size-5' />
							</a>
						</div>
					</div>

					<div data-gsap-item>
						<h4 className='mb-3 text-sm font-semibold tracking-wide'>Product</h4>
						<ul className='space-y-2 text-sm text-muted-foreground'>
							<li>
								<Link className='hover:text-foreground transition-colors' href='#features'>
									Features
								</Link>
							</li>
							<li>
								<Link className='hover:text-foreground transition-colors' href='/watchlist'>
									Watchlist
								</Link>
							</li>
							<li>
								<Link className='hover:text-foreground transition-colors' href='/portfolio'>
									Portfolio
								</Link>
							</li>
							<li>
								<Link className='hover:text-foreground transition-colors' href='/docs' target='_blank'>
									API Documentation
								</Link>
							</li>
						</ul>
					</div>

					<div data-gsap-item>
						<h4 className='mb-3 text-sm font-semibold tracking-wide'>Legal</h4>
						<ul className='space-y-2 text-sm text-muted-foreground'>
							<li>
								<Link className='hover:text-foreground transition-colors' href='/privacy-policy'>
									Privacy Policy
								</Link>
							</li>
							<li>
								<Link className='hover:text-foreground transition-colors' href='/terms-of-service'>
									Terms of Service
								</Link>
							</li>
						</ul>
					</div>

					<div data-gsap-item>
						<h4 className='mb-3 text-sm font-semibold tracking-wide'>Account</h4>
						<ul className='space-y-2 text-sm text-muted-foreground'>
							<li>
								<Link className='hover:text-foreground transition-colors' href='/login'>
									Login
								</Link>
							</li>
							<li>
								<Link className='hover:text-foreground transition-colors' href='/signup'>
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
	);
}

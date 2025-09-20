import { ChevronLeft, FileText } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { env } from '@/env';

export const metadata: Metadata = {
	description: 'Read the Terms of Service governing the use of this website and application.',
	title: 'Terms of Service'
};

export default function TermsOfServicePage() {
	const appName = env.APP_NAME ?? 'Invest-igator';
	const updated = new Date().toLocaleDateString(undefined, {
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	});

	const sections = [
		{ id: 'use-of-the-service', title: 'Use of the Service' },
		{ id: 'accounts-and-security', title: 'Accounts and Security' },
		{ id: 'data-and-privacy', title: 'Data and Privacy' },
		{ id: 'third-party-services', title: 'Third-Party Services' },
		{ id: 'disclaimers-and-liability', title: 'Disclaimers & Liability' },
		{ id: 'changes-to-the-terms', title: 'Changes to the Terms' },
		{ id: 'contact', title: 'Contact' }
	];

	return (
		<main className='mx-auto w-full max-w-6xl px-6 py-10'>
			<div className='mb-8 rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background p-6'>
				<div className='flex items-start justify-between gap-4'>
					<div className='flex items-center gap-3'>
						<span className='grid size-10 place-items-center rounded-lg bg-primary/15 text-primary'>
							<FileText className='size-5' />
						</span>
						<div>
							<h1 className='text-3xl font-semibold tracking-tight'>Terms of Service</h1>
							<p className='text-muted-foreground mt-1 text-sm'>
								The rules for using {appName}. Please read carefully.
							</p>
						</div>
					</div>
					<Button asChild className='-mr-2' size='sm' variant='ghost'>
						<Link href='/'>
							<ChevronLeft className='mr-1 size-4' /> Back to home
						</Link>
					</Button>
				</div>
				<div className='mt-4'>
					<Badge variant='secondary'>Last updated: {updated}</Badge>
				</div>
			</div>

			<div className='grid gap-8 lg:grid-cols-[220px_1fr]'>
				<aside className='hidden lg:block'>
					<nav aria-label='Table of contents' className='sticky top-24 rounded-xl border bg-card p-4 text-sm'>
						<p className='mb-2 font-medium'>On this page</p>
						<ul className='space-y-1'>
							{sections.map((s) => (
								<li key={s.id}>
									<Link className='text-muted-foreground hover:text-foreground' href={`#${s.id}`}>
										{s.title}
									</Link>
								</li>
							))}
						</ul>
					</nav>
				</aside>

				<section aria-labelledby='tos-title'>
					<Card>
						<CardContent className='prose prose-neutral dark:prose-invert max-w-none p-6'>
							{/* TODO: Replace the placeholders below with your finalized Terms of Service text. */}
							<p>
								This Terms of Service ("Terms") governs your access to and use of {appName}. By
								accessing or using the service, you agree to be bound by these Terms.
							</p>

							<h2 id='use-of-the-service'>1. Use of the Service</h2>
							<p>
								Provide your service usage terms here. Describe eligibility, permitted use, and
								restrictions as applicable to your product.
							</p>

							<h2 id='accounts-and-security'>2. Accounts and Security</h2>
							<p>
								Outline account responsibilities, accuracy of information, and security expectations.
								Include guidance on safeguarding credentials and reporting unauthorized access.
							</p>

							<h2 id='data-and-privacy'>3. Data and Privacy</h2>
							<p>
								Reference your <Link href='/privacy-policy'>Privacy Policy</Link> for details on how
								data is collected, used, and shared.
							</p>

							<h2 id='third-party-services'>4. Third-Party Services</h2>
							<p>
								Note any integrations or third-party services and the fact that their terms and privacy
								policies govern their use.
							</p>

							<h2 id='disclaimers-and-liability'>5. Disclaimers and Limitation of Liability</h2>
							<p>
								Insert disclaimers appropriate to your application and any limitations of liability
								permitted by applicable law.
							</p>

							<h2 id='changes-to-the-terms'>6. Changes to the Terms</h2>
							<p>
								Explain how and when you may update these Terms and how users will be notified of
								changes.
							</p>

							<h2 id='contact'>Contact</h2>
							<p>
								For questions about these Terms, contact the team via the channels listed in the app or
								repository.
							</p>
						</CardContent>
					</Card>
				</section>
			</div>
		</main>
	);
}

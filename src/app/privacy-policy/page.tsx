import { ChevronLeft, Shield } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { env } from '@/env';

export const metadata: Metadata = {
	description: 'Understand how we collect, use, and protect your data.',
	title: 'Privacy Policy'
};

// Ensure this route is statically generated at build time
export const dynamic = 'force-static';

export default function PrivacyPolicyPage() {
	const appName = env.APP_NAME ?? 'Invest-igator';
	const updated = new Date().toLocaleDateString(undefined, {
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	});

	const sections = [
		{ id: 'information-we-collect', title: 'Information We Collect' },
		{ id: 'how-we-use-information', title: 'How We Use Information' },
		{ id: 'sharing-and-transfers', title: 'Sharing and Transfers' },
		{ id: 'cookies-and-tracking', title: 'Cookies and Tracking' },
		{ id: 'data-retention', title: 'Data Retention' },
		{ id: 'your-rights', title: 'Your Rights' },
		{ id: 'security', title: 'Security' },
		{ id: 'changes', title: 'Changes' },
		{ id: 'contact', title: 'Contact' }
	];

	return (
		<main className='mx-auto w-full max-w-6xl px-6 py-10'>
			<div className='mb-8 rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background p-6'>
				<div className='flex items-start justify-between gap-4'>
					<div className='flex items-center gap-3'>
						<span className='grid size-10 place-items-center rounded-lg bg-primary/15 text-primary'>
							<Shield className='size-5' />
						</span>
						<div>
							<h1 className='text-3xl font-semibold tracking-tight'>Privacy Policy</h1>
							<p className='text-muted-foreground mt-1 text-sm'>
								How {appName} collects, uses, and protects your data.
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

				<section aria-labelledby='privacy-title'>
					<Card>
						<CardContent className='prose prose-neutral dark:prose-invert max-w-none p-6'>
							{/* TODO: Replace the placeholders below with your finalized Privacy Policy text. */}
							<p>
								This Privacy Policy explains how {appName} collects, uses, and shares information when
								you use our services.
							</p>

							<h2 id='information-we-collect'>1. Information We Collect</h2>
							<p>
								Describe categories such as account data, usage data, device information, cookies, and
								any integrations.
							</p>

							<h2 id='how-we-use-information'>2. How We Use Information</h2>
							<p>
								Explain purposes like providing and improving services, authentication, security,
								analytics, and communications.
							</p>

							<h2 id='sharing-and-transfers'>3. Sharing and Transfers</h2>
							<p>
								Note any sharing with service providers, legal compliance, and how international
								transfers (if any) are handled.
							</p>

							<h2 id='cookies-and-tracking'>4. Cookies and Tracking</h2>
							<p>
								Reference the app's consent management. Describe cookie categories and how users can
								manage preferences.
							</p>

							<h2 id='data-retention'>5. Data Retention</h2>
							<p>State retention periods or criteria used to determine how long information is kept.</p>

							<h2 id='your-rights'>6. Your Rights</h2>
							<p>
								Outline rights such as access, correction, deletion, and preferences, subject to
								applicable laws.
							</p>

							<h2 id='security'>7. Security</h2>
							<p>
								Summarize safeguards used to protect information and note that no system is completely
								secure.
							</p>

							<h2 id='changes'>8. Changes</h2>
							<p>
								Explain how changes to this policy will be communicated and where the latest version can
								be found.
							</p>

							<h2 id='contact'>Contact</h2>
							<p>
								For privacy inquiries, contact the team via the channels listed in the app or
								repository.
							</p>
						</CardContent>
					</Card>
				</section>
			</div>
		</main>
	);
}

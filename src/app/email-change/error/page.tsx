import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
	title: 'Email Change Failed — Invest-igator'
};

export default async function EmailChangeErrorPage({
	searchParams
}: {
	searchParams?: Promise<{ reason?: string }>;
}) {
	const sp = (await searchParams) ?? {};
	const reason = sp.reason ?? 'Unable to confirm email change.';
	return (
		<div className='mx-auto max-w-md p-6'>
			<Card>
				<CardHeader>
					<CardTitle>Something went wrong</CardTitle>
					<CardDescription>We couldn’t complete your email change.</CardDescription>
				</CardHeader>
				<CardContent className='space-y-4'>
					<p className='text-sm text-muted-foreground'>{reason}</p>
					<div className='flex gap-2'>
						<Button asChild variant='secondary'>
							<Link href='/account?tab=profile'>Back to Account</Link>
						</Button>
						<Button asChild>
							<Link href='/'>Go Home</Link>
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

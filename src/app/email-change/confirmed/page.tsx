import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
	title: 'Email Updated — Invest-igator'
};

export default function EmailChangeConfirmedPage() {
	return (
		<div className='mx-auto max-w-md p-6'>
			<Card>
				<CardHeader>
					<CardTitle>Email updated</CardTitle>
					<CardDescription>Your email address has been successfully changed.</CardDescription>
				</CardHeader>
				<CardContent className='space-y-4'>
					<p>You can safely close this tab or head back to your account settings.</p>
					<Button asChild>
						<Link href='/account'>Back to Account</Link>
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}

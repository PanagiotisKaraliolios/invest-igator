import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { auth } from '@/server/auth';
import SignOutButton from './_components/signout-button';

export default async function SignOutPage() {
	const session = await auth();
	if (!session?.user) {
		redirect('/login');
	}

	return (
		<main className='container mx-auto px-6 py-16'>
			<div className='mx-auto max-w-md'>
				<Card>
					<CardHeader>
						<CardTitle>Sign out</CardTitle>
						<CardDescription>Confirm you want to end your session.</CardDescription>
					</CardHeader>
					<CardContent className='flex items-center justify-between gap-3'>
						<Button asChild variant='ghost'>
							<Link href='/dashboard'>Cancel</Link>
						</Button>
						<SignOutButton label='Sign out' size='sm' variant='destructive' />
					</CardContent>
				</Card>
			</div>
		</main>
	);
}

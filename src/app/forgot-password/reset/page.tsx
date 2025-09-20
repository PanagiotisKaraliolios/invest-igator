import { notFound } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import ResetPasswordForm from './reset-form';

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
	const { token } = await searchParams;
	if (!token) {
		notFound();
	}
	return (
		<div className='mx-auto max-w-md p-4'>
			<Card>
				<CardHeader className='text-center'>
					<CardTitle className='text-xl'>Choose a new password</CardTitle>
					<CardDescription>Enter and confirm your new password.</CardDescription>
				</CardHeader>
				<CardContent>
					<ResetPasswordForm token={token!} />
				</CardContent>
			</Card>
		</div>
	);
}

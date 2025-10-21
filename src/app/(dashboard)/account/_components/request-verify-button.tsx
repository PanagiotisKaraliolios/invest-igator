'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { sendVerificationEmail } from '@/lib/auth-client';

export function RequestVerifyButton({ email }: { email: string }) {
	const [isPending, setIsPending] = useState(false);

	const handleClick = async () => {
		if (!email) {
			toast.error('No email address found');
			return;
		}

		setIsPending(true);
		try {
			await sendVerificationEmail({
				callbackURL: '/',
				email
			});
			toast.success('Verification email sent');
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to send verification email');
		} finally {
			setIsPending(false);
		}
	};

	return (
		<Button disabled={isPending} onClick={handleClick} size='sm' type='button' variant='default'>
			{isPending && <Spinner className='mr-2' />}
			{isPending ? 'Sending…' : 'Verify email'}
		</Button>
	);
}

export default RequestVerifyButton;

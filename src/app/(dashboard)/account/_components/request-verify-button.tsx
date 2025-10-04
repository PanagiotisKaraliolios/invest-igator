'use client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/trpc/react';

export function RequestVerifyButton() {
	const request = api.account.requestEmailVerification.useMutation({
		onError: (e) => toast.error(e.message || 'Failed to send verification email'),
		onSuccess: () => toast.success('Verification email sent')
	});
	return (
		<Button disabled={request.isPending} onClick={() => request.mutate()} size='sm' variant='default'>
			{request.isPending && <Spinner className='mr-2' />}
			{request.isPending ? 'Sending…' : 'Verify email'}
		</Button>
	);
}

export default RequestVerifyButton;

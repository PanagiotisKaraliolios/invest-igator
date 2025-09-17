'use client';
import { signOut } from 'next-auth/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/trpc/react';

export default function DangerZoneCard() {
	const [confirming, setConfirming] = useState(false);
	const del = api.account.deleteAccount.useMutation({
		onError: (e) => toast.error(e.message || 'Failed to delete account'),
		onSuccess: () => {
			toast.success('Account deleted');
			void signOut({ callbackUrl: '/' });
		}
	});

	return (
		<Card className='border-destructive/40'>
			<CardHeader>
				<CardTitle className='text-destructive'>Danger zone</CardTitle>
				<CardDescription>This action is irreversible. All data will be removed.</CardDescription>
			</CardHeader>
			<CardContent>
				<p className='text-sm text-muted-foreground'>
					Deleting your account will permanently remove your data, including watchlists and transactions.
				</p>
			</CardContent>
			<CardFooter className='flex items-center gap-2'>
				{!confirming ? (
					<Button onClick={() => setConfirming(true)} variant='destructive'>
						Delete account
					</Button>
				) : (
					<>
						<Button disabled={del.isPending} onClick={() => setConfirming(false)} variant='outline'>
							Cancel
						</Button>
						<Button
							disabled={del.isPending}
							onClick={() => del.mutate({ confirm: true })}
							variant='destructive'
						>
							Confirm delete
						</Button>
					</>
				)}
			</CardFooter>
		</Card>
	);
}

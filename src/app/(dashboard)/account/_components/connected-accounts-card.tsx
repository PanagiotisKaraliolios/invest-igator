'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { providerLabel, providerIcons as sharedProviderIcons } from '@/lib/auth/providerMeta';
import { availableAuthProvidersQueryOptions } from '@/lib/auth/providersQuery';
import { signIn } from '@/lib/auth-client';
import { api } from '@/trpc/react';

const providerIcons = sharedProviderIcons;

export default function ConnectedAccountsCard() {
	const utils = api.useUtils();
	const { data: accounts, isLoading, isError } = api.account.listOAuthAccounts.useQuery();
	const providersQuery = useQuery(availableAuthProvidersQueryOptions());
	const [confirm, setConfirm] = useState<{ id: string; provider: string } | null>(null);
	const disconnect = api.account.disconnectOAuthAccount.useMutation({
		onError: (err) => {
			toast.error(err.message || 'Could not disconnect');
		},
		onSuccess: async () => {
			toast.success('Disconnected');
			await utils.account.listOAuthAccounts.invalidate();
		}
	});

	function onDisconnect(id: string) {
		disconnect.mutate({ accountId: id });
	}

	async function onConnect(provider: string) {
		// Use Better Auth to initiate OAuth linking for the signed-in user
		await signIn.social({
			callbackURL: '/account?tab=security',
			provider: provider as 'discord'
		});
	}

	const connectableProviders = useMemo(() => {
		const connected = new Set((accounts ?? []).map((a) => a.providerId));
		return (providersQuery.data ?? []).filter((id) => !connected.has(id));
	}, [accounts, providersQuery.data]);

	return (
		<>
			<Card>
				<CardHeader>
					<CardTitle>Connected accounts</CardTitle>
					<CardDescription>Manage third-party providers linked to your profile.</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<Skeleton className='h-10 w-full' />
					) : isError ? (
						<Alert variant='destructive'>
							<AlertDescription>Failed to load connected accounts.</AlertDescription>
						</Alert>
					) : (
						<div className='space-y-3'>
							{(accounts ?? []).length === 0 ? (
								<p className='text-sm text-muted-foreground'>No connected accounts.</p>
							) : (
								<ul className='divide-y'>
									{(accounts ?? []).map((acc) => {
										const Icon = providerIcons[acc.providerId];
										const label = providerLabel[acc.providerId] ?? acc.providerId;
										return (
											<li className='flex items-center justify-between py-2' key={acc.id}>
												<div className='flex items-center gap-2'>
													{Icon ? <Icon className='h-4 w-4' /> : null}
													<span className='font-medium'>{label}</span>
												</div>
												<Button
													data-testid={`disconnect-${acc.providerId}`}
													disabled={disconnect.isPending}
													onClick={() => setConfirm({ id: acc.id, provider: acc.providerId })}
													size='sm'
													variant='outline'
												>
													Disconnect
												</Button>
											</li>
										);
									})}
								</ul>
							)}
							<Separator className='my-2' />
							<div className='grid w-full grid-cols-1 gap-2'>
								{providersQuery.isLoading ? (
									<p className='text-sm text-muted-foreground'>Loading providers…</p>
								) : providersQuery.isError ? (
									<p className='text-sm text-destructive'>Failed to load providers.</p>
								) : connectableProviders.length === 0 ? (
									<p className='text-sm text-muted-foreground'>No additional providers available.</p>
								) : (
									connectableProviders.map((p) => {
										const Icon = providerIcons[p];
										return (
											<Button
												className='flex w-full items-center justify-center gap-2'
												data-testid={`connect-${p}`}
												key={p}
												onClick={() => onConnect(p)}
												size='sm'
												variant='outline'
											>
												{Icon ? <Icon className='inline-block' /> : null}
												Connect {p.charAt(0).toUpperCase() + p.slice(1)}
											</Button>
										);
									})
								)}
							</div>
						</div>
					)}
				</CardContent>
			</Card>
			<AlertDialog onOpenChange={(o) => !o && setConfirm(null)} open={!!confirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Disconnect {confirm ? (providerLabel[confirm.provider] ?? confirm.provider) : 'provider'}?
						</AlertDialogTitle>
						<AlertDialogDescription>
							This will remove the connection to your account. If this is your only sign-in method, you
							may not be able to sign in until you set another method.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel data-testid='cancel-disconnect' disabled={disconnect.isPending}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							data-testid={confirm ? `confirm-disconnect-${confirm.provider}` : 'confirm-disconnect'}
							disabled={disconnect.isPending}
							onClick={() => {
								if (confirm) {
									onDisconnect(confirm.id);
								}
								setConfirm(null);
							}}
						>
							Disconnect
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

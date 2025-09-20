'use client';

import { getProviders, signIn } from 'next-auth/react';
import { useEffect, useMemo, useState } from 'react';
import { FaDiscord, FaGithub } from 'react-icons/fa';
import { FcGoogle } from 'react-icons/fc';
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
import { providerLabel, providerIcons as sharedProviderIcons } from '@/lib/auth/providerMeta';
import { api } from '@/trpc/react';

const providerIcons = sharedProviderIcons;

export default function ConnectedAccountsCard() {
	const utils = api.useUtils();
	const { data: accounts, isLoading, isError } = api.account.listOAuthAccounts.useQuery();
	const [availableProviders, setAvailableProviders] = useState<string[]>([]);
	const [loadingProviders, setLoadingProviders] = useState(true);
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
		// Use NextAuth helper to initiate OAuth linking for the signed-in user
		await signIn(provider, { callbackUrl: '/account?tab=security' });
	}

	useEffect(() => {
		getProviders()
			.then((p) => {
				if (!p) return setAvailableProviders([]);
				const filtered = Object.values(p)
					.filter((prov) => prov.type !== 'email' && prov.id !== 'credentials')
					.map((prov) => prov.id);
				setAvailableProviders(filtered);
			})
			.finally(() => setLoadingProviders(false));
	}, []);

	const connectableProviders = useMemo(() => {
		const connected = new Set((accounts ?? []).map((a) => a.provider));
		return availableProviders.filter((id) => !connected.has(id));
	}, [accounts, availableProviders]);

	return (
		<>
			<Card>
				<CardHeader>
					<CardTitle>Connected accounts</CardTitle>
					<CardDescription>Manage third-party providers linked to your profile.</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<p className='text-sm text-muted-foreground'>Loading…</p>
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
										const Icon = providerIcons[acc.provider];
										const label = providerLabel[acc.provider] ?? acc.provider;
										return (
											<li className='flex items-center justify-between py-2' key={acc.id}>
												<div className='flex items-center gap-2'>
													{Icon ? <Icon className='h-4 w-4' /> : null}
													<span className='font-medium'>{label}</span>
												</div>
												<Button
													data-testid={`disconnect-${acc.provider}`}
													disabled={disconnect.isPending}
													onClick={() => setConfirm({ id: acc.id, provider: acc.provider })}
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
								{loadingProviders ? (
									<p className='text-sm text-muted-foreground'>Loading providers…</p>
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

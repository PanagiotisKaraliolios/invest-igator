'use client';

import { format } from 'date-fns';
import {
	Ban,
	Calendar,
	Check,
	Clock,
	Copy,
	Edit,
	MoreVertical,
	RefreshCw,
	Shield,
	Trash2,
	TrendingUp
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { describePermissions, formatPermissions } from '@/lib/api-key-permissions';
import { api } from '@/trpc/react';
import { CreateApiKeyDialog, EditApiKeyDialog } from './api-key-dialog';
import { ApiKeyDisplayDialog } from './api-key-display-dialog';

export function ApiKeysCard() {
	const [keyToDelete, setKeyToDelete] = useState<string | null>(null);
	const [keyToEdit, setKeyToEdit] = useState<string | null>(null);
	const [newApiKey, setNewApiKey] = useState<{
		key: string;
		name: string | null;
	} | null>(null);
	const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

	const utils = api.useUtils();
	const { data: apiKeys, isLoading } = api.apiKeys.list.useQuery();

	const deleteMutation = api.apiKeys.delete.useMutation({
		onError: (error) => {
			toast.error(error.message);
		},
		onSuccess: () => {
			toast.success('API key deleted');
			void utils.apiKeys.list.invalidate();
			setKeyToDelete(null);
		}
	});

	const updateMutation = api.apiKeys.update.useMutation({
		onError: (error) => {
			toast.error(error.message);
		},
		onSuccess: () => {
			toast.success('API key updated');
			void utils.apiKeys.list.invalidate();
		}
	});

	const handleCopyStart = async (start: string | null, keyId: string) => {
		if (!start) return;
		await navigator.clipboard.writeText(start);
		setCopiedKeyId(keyId);
		toast.success('Key prefix copied');
		setTimeout(() => setCopiedKeyId(null), 2000);
	};

	const handleDelete = (keyId: string) => {
		deleteMutation.mutate({ keyId });
	};

	const handleToggleEnabled = (keyId: string, currentEnabled: boolean) => {
		const key = apiKeys?.find((k) => k.id === keyId);
		if (!key) return;

		updateMutation.mutate({
			enabled: !currentEnabled,
			keyId,
			name: key.name ?? 'Unnamed Key',
			permissions: key.permissions ?? undefined,
			rateLimitEnabled: key.rateLimitEnabled,
			rateLimitMax: key.rateLimitMax ?? undefined,
			rateLimitTimeWindow: key.rateLimitTimeWindow ?? undefined
		});
	};

	const isExpired = (expiresAt: Date | null) => {
		if (!expiresAt) return false;
		return new Date() > new Date(expiresAt);
	};

	return (
		<>
			<Card>
				<CardHeader>
					<div className='flex items-center justify-between'>
						<div>
							<CardTitle>API Keys</CardTitle>
							<CardDescription>Manage API keys for programmatic access to your account</CardDescription>
						</div>
						<CreateApiKeyDialog onSuccess={(key, name) => setNewApiKey({ key, name })} />
					</div>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className='space-y-3'>
							<Skeleton className='h-20 w-full' />
							<Skeleton className='h-20 w-full' />
						</div>
					) : apiKeys && apiKeys.length > 0 ? (
						<div className='space-y-3'>
							{apiKeys.map((key) => (
								<div
									className={`flex items-center justify-between rounded-lg border p-4 ${!key.enabled ? 'opacity-60 bg-muted/30' : ''}`}
									key={key.id}
								>
									<div className='flex-1'>
										<div className='flex items-center gap-2'>
											<p className='font-medium'>{key.name || 'Unnamed Key'}</p>
											{isExpired(key.expiresAt) && <Badge variant='destructive'>Expired</Badge>}
											{!key.enabled && (
												<Badge className='gap-1' variant='destructive'>
													<Ban className='h-3 w-3' />
													Disabled
												</Badge>
											)}
											{key.permissions && (
												<Popover>
													<PopoverTrigger asChild>
														<Button className='h-6 gap-1 px-2' size='sm' variant='outline'>
															<Shield className='h-3 w-3' />
															<span className='text-xs'>
																{formatPermissions(key.permissions)}
															</span>
														</Button>
													</PopoverTrigger>
													<PopoverContent align='start' className='w-80'>
														<div className='space-y-2'>
															<h4 className='font-medium text-sm'>Permissions</h4>
															<div className='space-y-1 text-sm text-muted-foreground'>
																{describePermissions(key.permissions).map((desc, i) => (
																	<div key={i}>• {desc}</div>
																))}
															</div>
														</div>
													</PopoverContent>
												</Popover>
											)}
										</div>

										{/* Key prefix with copy button */}
										<div className='mt-2 flex items-center gap-1'>
											<code className='rounded bg-muted px-1.5 py-0.5 font-mono text-xs'>
												{key.start || 'No prefix'}
											</code>
											{key.start && (
												<Button
													className='h-6 w-6 p-0'
													onClick={() => handleCopyStart(key.start, key.id)}
													size='sm'
													variant='ghost'
												>
													{copiedKeyId === key.id ? (
														<Check className='h-3 w-3' />
													) : (
														<Copy className='h-3 w-3' />
													)}
												</Button>
											)}
										</div>

										{/* Detailed information grid */}
										<div className='mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-muted-foreground'>
											{/* Created date */}
											<div className='flex items-center gap-1.5'>
												<Calendar className='h-3.5 w-3.5' />
												<span>Created {format(new Date(key.createdAt), 'MMM d, yyyy')}</span>
											</div>

											{/* Expiration */}
											{key.expiresAt ? (
												<div className='flex items-center gap-1.5'>
													<Clock className='h-3.5 w-3.5' />
													<span>
														Expires {format(new Date(key.expiresAt), 'MMM d, yyyy')}
													</span>
												</div>
											) : (
												<div className='flex items-center gap-1.5'>
													<Clock className='h-3.5 w-3.5' />
													<span>Never expires</span>
												</div>
											)}

											{/* Request count */}
											{key.requestCount !== null && key.requestCount !== undefined && (
												<div className='flex items-center gap-1.5'>
													<TrendingUp className='h-3.5 w-3.5' />
													<span>{key.requestCount.toLocaleString()} requests made</span>
												</div>
											)}

											{/* Rate limit info */}
											{key.rateLimitEnabled && key.rateLimitMax && key.rateLimitTimeWindow && (
												<div className='flex items-center gap-1.5'>
													<RefreshCw className='h-3.5 w-3.5' />
													<span>
														{key.remaining ?? key.rateLimitMax}/{key.rateLimitMax} per{' '}
														{key.rateLimitTimeWindow >= 3600000
															? `${key.rateLimitTimeWindow / 3600000}h`
															: key.rateLimitTimeWindow >= 60000
																? `${key.rateLimitTimeWindow / 60000}m`
																: `${key.rateLimitTimeWindow / 1000}s`}
													</span>
												</div>
											)}

											{/* Last used */}
											{key.lastRequest && (
												<div className='flex items-center gap-1.5'>
													<Clock className='h-3.5 w-3.5' />
													<span>
														Last used {format(new Date(key.lastRequest), 'MMM d, yyyy')}
													</span>
												</div>
											)}

											{/* Refill info */}
											{key.refillAmount && key.refillInterval && (
												<div className='flex items-center gap-1.5'>
													<RefreshCw className='h-3.5 w-3.5' />
													<span>
														Refills {key.refillAmount} every{' '}
														{key.refillInterval >= 3600000
															? `${key.refillInterval / 3600000}h`
															: key.refillInterval >= 60000
																? `${key.refillInterval / 60000}m`
																: `${key.refillInterval / 1000}s`}
													</span>
												</div>
											)}
										</div>
									</div>
									<div className='flex items-center gap-2'>
										<div className='flex items-center gap-2'>
											<span className='text-sm text-muted-foreground'>
												{key.enabled ? 'Enabled' : 'Disabled'}
											</span>
											<Switch
												checked={key.enabled}
												disabled={updateMutation.isPending || isExpired(key.expiresAt)}
												onCheckedChange={() => handleToggleEnabled(key.id, key.enabled)}
											/>
										</div>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button
													data-testid={`api-key-menu-${key.id}`}
													size='sm'
													variant='ghost'
												>
													<MoreVertical className='h-4 w-4' />
													<span className='sr-only'>Open menu</span>
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align='end'>
												<DropdownMenuItem
													data-testid='edit-api-key-button'
													onClick={() => setKeyToEdit(key.id)}
												>
													<Edit className='mr-2 h-4 w-4' />
													Edit
												</DropdownMenuItem>
												<DropdownMenuItem
													className='text-destructive'
													data-testid='delete-api-key-button'
													onClick={() => setKeyToDelete(key.id)}
												>
													<Trash2 className='mr-2 h-4 w-4' />
													Delete
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
								</div>
							))}
						</div>
					) : (
						<div className='text-center text-sm text-muted-foreground'>
							No API keys yet. Create one to get started.
						</div>
					)}
				</CardContent>
			</Card>

			<AlertDialog onOpenChange={(open) => !open && setKeyToDelete(null)} open={keyToDelete !== null}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete API Key</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete this API key? This action cannot be undone and any
							applications using this key will stop working.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
							data-testid='confirm-delete-api-key'
							disabled={deleteMutation.isPending}
							onClick={() => keyToDelete && handleDelete(keyToDelete)}
						>
							{deleteMutation.isPending ? 'Deleting...' : 'Delete'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{newApiKey && (
				<ApiKeyDisplayDialog
					apiKey={newApiKey.key}
					keyName={newApiKey.name}
					onOpenChange={(open) => !open && setNewApiKey(null)}
					open={true}
				/>
			)}

			{keyToEdit && apiKeys && (
				<EditApiKeyDialog
					apiKey={
						apiKeys.find((k) => k.id === keyToEdit) ?? {
							enabled: true,
							id: keyToEdit,
							name: null,
							permissions: null,
							rateLimitEnabled: false,
							rateLimitMax: null,
							rateLimitTimeWindow: null
						}
					}
					onClose={() => setKeyToEdit(null)}
					open={true}
				/>
			)}
		</>
	);
}

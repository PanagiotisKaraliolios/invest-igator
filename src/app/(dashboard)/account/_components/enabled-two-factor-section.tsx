'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CopyIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { authClient } from '@/lib/auth-client';

const regenPasswordSchema = z.object({
	password: z.string().min(1, 'Password is required to regenerate codes')
});

const disablePasswordSchema = z.object({
	password: z.string().min(1, 'Password is required to disable two-factor authentication')
});

interface EnabledTwoFactorSectionProps {
	hasPassword: boolean;
	recoveryCodesRemaining: number;
	onRefetch: () => Promise<unknown>;
}

export function EnabledTwoFactorSection({
	hasPassword,
	recoveryCodesRemaining,
	onRefetch
}: EnabledTwoFactorSectionProps) {
	const [regenCodes, setRegenCodes] = useState<string[] | null>(null);
	const [regenOpen, setRegenOpen] = useState(false);
	const [disableOpen, setDisableOpen] = useState(false);
	const [isRegenerating, setIsRegenerating] = useState(false);
	const [isDisabling, setIsDisabling] = useState(false);

	const regenForm = useForm<z.infer<typeof regenPasswordSchema>>({
		defaultValues: { password: '' },
		resolver: zodResolver(regenPasswordSchema)
	});

	const disableForm = useForm<z.infer<typeof disablePasswordSchema>>({
		defaultValues: { password: '' },
		resolver: zodResolver(disablePasswordSchema)
	});

	useEffect(() => {
		if (regenOpen) {
			// Only clear codes when opening the dialog, not when closing
			setRegenCodes(null);
			regenForm.reset();
		}
	}, [regenOpen, regenForm]);

	useEffect(() => {
		if (!disableOpen) {
			disableForm.reset();
		}
	}, [disableOpen, disableForm]);

	const handleRegenerate = async (values: z.infer<typeof regenPasswordSchema>) => {
		setIsRegenerating(true);
		try {
			const { data, error } = await authClient.twoFactor.generateBackupCodes({
				password: values.password
			});

			if (error) {
				toast.error(error.message || 'Failed to regenerate recovery codes');
				setIsRegenerating(false);
				return;
			}

			if (data) {
				setRegenCodes(data.backupCodes);
				await onRefetch();
				toast.success('New recovery codes generated');
				setRegenOpen(false);
			}
		} catch (err) {
			toast.error('An unexpected error occurred');
		} finally {
			setIsRegenerating(false);
		}
	};

	const handleDisable = async (values: z.infer<typeof disablePasswordSchema>) => {
		setIsDisabling(true);
		try {
			const { data, error } = await authClient.twoFactor.disable({
				password: values.password
			});

			if (error) {
				toast.error(error.message || 'Failed to disable two-factor authentication');
				setIsDisabling(false);
				return;
			}

			if (data) {
				disableForm.reset();
				setDisableOpen(false);
				await onRefetch();
				toast.success('Two-factor authentication disabled');
			}
		} catch (err) {
			toast.error('An unexpected error occurred');
		} finally {
			setIsDisabling(false);
		}
	};

	const message = recoveryCodesRemaining
		? `${recoveryCodesRemaining} recovery code${recoveryCodesRemaining === 1 ? '' : 's'} remaining.`
		: 'No recovery codes remaining. Regenerate new codes before you need them.';

	return (
		<div className='space-y-4'>
			<p className='text-sm text-green-600 dark:text-green-400'>
				Two-factor authentication is active on your account.
			</p>
			<p className='text-sm'>{message}</p>
			{regenCodes ? (
				<div className='space-y-2 rounded-md border border-yellow-300/60 bg-yellow-50 p-4 text-yellow-900 dark:border-yellow-700/60 dark:bg-yellow-950/40 dark:text-yellow-100'>
					<div className='flex items-center justify-between'>
						<p className='font-medium'>Your new recovery codes</p>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									className='size-8'
									onClick={async () => {
										try {
											await navigator.clipboard.writeText(regenCodes.join('\n'));
											toast.success('Recovery codes copied');
										} catch {
											toast.error('Failed to copy recovery codes');
										}
									}}
									size='icon'
									variant='outline'
								>
									<CopyIcon className='size-3' />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Copy new recovery codes</TooltipContent>
						</Tooltip>
					</div>
					<p className='text-xs text-yellow-900/80 dark:text-yellow-200/80'>
						Store these now. They will not be shown again.
					</p>
					<div className='mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3'>
						{regenCodes.map((code) => (
							<code
								className='rounded border bg-background px-2 py-1 text-center font-mono text-sm'
								key={code}
							>
								{code}
							</code>
						))}
					</div>
				</div>
			) : null}
			<div className='flex flex-wrap gap-2'>
				<Dialog onOpenChange={setRegenOpen} open={regenOpen}>
					<DialogTrigger asChild>
						<Button variant='outline'>Regenerate recovery codes</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Regenerate recovery codes</DialogTitle>
							<DialogDescription>
								Enter your password to generate new recovery codes. New codes replace existing ones.
							</DialogDescription>
						</DialogHeader>
						<Form {...regenForm}>
							<form className='space-y-3' onSubmit={regenForm.handleSubmit(handleRegenerate)}>
								<FormField
									control={regenForm.control}
									name='password'
									render={({ field }) => (
										<FormItem>
											<FormLabel>Password</FormLabel>
											<FormControl>
												<Input
													autoComplete='current-password'
													disabled={isRegenerating}
													type='password'
													{...field}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<DialogFooter>
									<Button disabled={isRegenerating} type='submit'>
										{isRegenerating && <Spinner className='mr-2' />}
										{isRegenerating ? 'Generating…' : 'Generate new codes'}
									</Button>
								</DialogFooter>
							</form>
						</Form>
					</DialogContent>
				</Dialog>
				<Dialog onOpenChange={setDisableOpen} open={disableOpen}>
					<DialogTrigger asChild>
						<Button variant='destructive'>Disable two-factor</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Disable two-factor authentication</DialogTitle>
							<DialogDescription>
								Enter your password to disable two-factor authentication.
							</DialogDescription>
						</DialogHeader>
						<Form {...disableForm}>
							<form className='space-y-3' onSubmit={disableForm.handleSubmit(handleDisable)}>
								<FormField
									control={disableForm.control}
									name='password'
									render={({ field }) => (
										<FormItem>
											<FormLabel>Password</FormLabel>
											<FormControl>
												<Input
													autoComplete='current-password'
													disabled={isDisabling}
													type='password'
													{...field}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<DialogFooter>
									<Button disabled={isDisabling} type='submit' variant='destructive'>
										{isDisabling && <Spinner className='mr-2' />}
										{isDisabling ? 'Disabling…' : 'Disable two-factor'}
									</Button>
								</DialogFooter>
							</form>
						</Form>
					</DialogContent>
				</Dialog>
			</div>
		</div>
	);
}

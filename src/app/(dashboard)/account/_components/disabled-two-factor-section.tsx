'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { authClient } from '@/lib/auth-client';
import type { TwoFactorSetupPayload } from './pending-two-factor-section';

interface DisabledTwoFactorSectionProps {
	onRefetch: () => Promise<unknown>;
	onSetupStarted: (payload: TwoFactorSetupPayload) => void;
}

const passwordSchema = z.object({
	password: z.string().min(1, 'Password is required')
});

export function DisabledTwoFactorSection({ onRefetch, onSetupStarted }: DisabledTwoFactorSectionProps) {
	const [isDialogOpen, setIsDialogOpen] = useState(false);
	const [isEnabling, setIsEnabling] = useState(false);

	const form = useForm<z.infer<typeof passwordSchema>>({
		defaultValues: { password: '' },
		resolver: zodResolver(passwordSchema)
	});

	const handleEnable = async (values: z.infer<typeof passwordSchema>) => {
		setIsEnabling(true);
		try {
			const { data, error } = await authClient.twoFactor.enable({
				password: values.password
			});

			if (error) {
				toast.error(error.message || 'Failed to enable two-factor authentication');
				setIsEnabling(false);
				return;
			}

			if (data) {
				// Extract secret from totpURI (format: otpauth://totp/...?secret=XXX&...)
				let secret = '';
				try {
					const url = new URL(data.totpURI);
					secret = url.searchParams.get('secret') || '';
				} catch {
					// If URL parsing fails, fallback to empty string
					secret = '';
				}

				// Convert Better Auth response to expected format
				onSetupStarted({
					otpauthUrl: data.totpURI,
					recoveryCodes: data.backupCodes,
					secret
				});
				await onRefetch();
				setIsDialogOpen(false);
				form.reset();
				toast.success('Two-factor setup started');
			}
		} catch (err) {
			toast.error('An unexpected error occurred');
		} finally {
			setIsEnabling(false);
		}
	};

	return (
		<>
			<div className='space-y-4'>
				<p className='text-sm'>Protect your account with an authenticator app.</p>
				<Button
				onClick={() => setIsDialogOpen(true)}>Enable two-factor authentication</Button>
			</div>

			<Dialog onOpenChange={setIsDialogOpen} open={isDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Enable Two-Factor Authentication</DialogTitle>
						<DialogDescription>Enter your password to begin setting up two-factor authentication.</DialogDescription>
					</DialogHeader>

					<Form {...form}>
						<form className='space-y-4' onSubmit={form.handleSubmit(handleEnable)}>
							<FormField
								control={form.control}
								name='password'
								render={({ field }) => (
									<FormItem>
										<FormLabel>Password</FormLabel>
										<FormControl>
											<Input {...field} autoComplete='current-password' type='password' />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<div className='flex justify-end gap-2'>
								<Button
									disabled={isEnabling}
									onClick={() => {
										setIsDialogOpen(false);
										form.reset();
									}}
									type='button'
									variant='outline'
								>
									Cancel
								</Button>
								<Button disabled={isEnabling} type='submit'>
									{isEnabling && <Spinner className='mr-2' />}
									{isEnabling ? 'Enabling…' : 'Continue'}
								</Button>
							</div>
						</form>
					</Form>
				</DialogContent>
			</Dialog>
		</>
	);
}

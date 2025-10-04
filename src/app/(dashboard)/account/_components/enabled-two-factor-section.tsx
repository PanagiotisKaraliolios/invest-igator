'use client';

import { zodResolver } from '@hookform/resolvers/zod';
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
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/trpc/react';

const regenVerificationSchema = z
	.object({
		code: z.string().optional(),
		password: z.string().optional()
	})
	.superRefine((data, ctx) => {
		const password = data.password?.trim() ?? '';
		const code = data.code?.trim() ?? '';
		if (!password) {
			ctx.addIssue({ code: 'custom', message: 'Password is required to regenerate codes.', path: ['password'] });
		}
		if (!code) {
			ctx.addIssue({
				code: 'custom',
				message: 'Authentication code is required to regenerate codes.',
				path: ['code']
			});
		}
	});

const disableSchema = z.object({
	code: z.string().min(6).max(64),
	password: z.string().optional()
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
	const [disableUseRecoveryCode, setDisableUseRecoveryCode] = useState(false);

	const regenForm = useForm<z.infer<typeof regenVerificationSchema>>({
		defaultValues: { code: '', password: '' },
		resolver: zodResolver(regenVerificationSchema)
	});

	const disableForm = useForm<z.infer<typeof disableSchema>>({
		defaultValues: { code: '', password: '' },
		resolver: zodResolver(disableSchema)
	});

	useEffect(() => {
		if (!hasPassword) {
			disableForm.setValue('password', '');
			disableForm.clearErrors('password');
		}
	}, [hasPassword, disableForm]);

	useEffect(() => {
		if (!regenOpen) {
			regenForm.reset();
		}
	}, [regenOpen, regenForm]);

	useEffect(() => {
		if (!disableOpen) {
			disableForm.reset();
			setDisableUseRecoveryCode(false);
		}
	}, [disableOpen, disableForm]);

	const regenerateRecoveryCodes = api.account.regenerateTwoFactorRecoveryCodes.useMutation({
		onError: (err) => toast.error(err.message || 'Failed to regenerate recovery codes'),
		onSuccess: (payload) => {
			setRegenCodes(payload.recoveryCodes);
			regenForm.reset();
			onRefetch();
			toast.success('New recovery codes generated');
		}
	});

	const disableTwoFactor = api.account.disableTwoFactor.useMutation({
		onError: (err) => toast.error(err.message || 'Failed to disable two-factor authentication'),
		onSuccess: () => {
			disableForm.reset();
			setDisableOpen(false);
			setDisableUseRecoveryCode(false);
			onRefetch();
			toast.success('Two-factor authentication disabled');
		}
	});

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
					<p className='font-medium'>Your new recovery codes</p>
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
								Provide your password and an authentication/recovery code to confirm. New codes replace
								existing ones.
							</DialogDescription>
						</DialogHeader>
						<Form {...regenForm}>
							<form
								className='space-y-3'
								onSubmit={regenForm.handleSubmit((values) => {
									regenerateRecoveryCodes.mutate({
										code: (values.code ?? '').trim(),
										password: (values.password ?? '').trim()
									});
								})}
							>
								<FormField
									control={regenForm.control}
									name='password'
									render={({ field }) => (
										<FormItem>
											<FormLabel>Password</FormLabel>
											<FormControl>
												<Input
													autoComplete='current-password'
													disabled={regenerateRecoveryCodes.isPending}
													type='password'
													{...field}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={regenForm.control}
									name='code'
									render={({ field }) => (
										<FormItem>
											<FormLabel>Authenticator or recovery code</FormLabel>
											<FormControl>
												<Input
													disabled={regenerateRecoveryCodes.isPending}
													placeholder='123456 or ABCDE-FGHIJ'
													{...field}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<DialogFooter>
									<Button disabled={regenerateRecoveryCodes.isPending} type='submit'>
										{regenerateRecoveryCodes.isPending && <Spinner className='mr-2' />}
										{regenerateRecoveryCodes.isPending ? 'Generating…' : 'Generate new codes'}
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
								{hasPassword
									? 'Confirm your identity before disabling two-factor authentication. Use your password and an authentication/recovery code.'
									: 'Confirm your identity with an authentication or recovery code before disabling two-factor authentication.'}
							</DialogDescription>
						</DialogHeader>
						<Form {...disableForm}>
							<form
								className='space-y-3'
								onSubmit={disableForm.handleSubmit((values) => {
									disableForm.clearErrors();
									const rawPassword = values.password?.trim() ?? '';
									let code = values.code?.trim() ?? '';
									const errors: { field: 'password' | 'code'; message: string }[] = [];
									if (!code)
										errors.push({
											field: 'code',
											message: 'Enter your authenticator or recovery code.'
										});
									if (hasPassword && rawPassword.length === 0)
										errors.push({ field: 'password', message: 'Enter your password.' });
									if (errors.length > 0) {
										errors.forEach((err) =>
											disableForm.setError(err.field, { message: err.message, type: 'manual' })
										);
										return;
									}
									if (disableUseRecoveryCode) {
										code = code.replace(/[^0-9a-z]/gi, '').toUpperCase();
										if (code.length < 10) {
											disableForm.setError('code', {
												message: 'Recovery codes are 10 characters long.',
												type: 'manual'
											});
											return;
										}
									} else {
										code = code.replace(/[^0-9]/g, '');
										if (code.length !== 6) {
											disableForm.setError('code', {
												message: 'Enter the 6-digit authenticator code.',
												type: 'manual'
											});
											return;
										}
									}
									disableTwoFactor.mutate({ code, password: rawPassword || undefined });
								})}
							>
								{hasPassword ? (
									<FormField
										control={disableForm.control}
										name='password'
										render={({ field }) => (
											<FormItem>
												<FormLabel>Password</FormLabel>
												<FormControl>
													<Input
														autoComplete='current-password'
														disabled={disableTwoFactor.isPending}
														type='password'
														{...field}
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
								) : null}
								<FormField
									control={disableForm.control}
									name='code'
									render={({ field }) => (
										<FormItem>
											<FormLabel>Authenticator or recovery code</FormLabel>
											<FormControl>
												<div className='space-y-2'>
													{disableUseRecoveryCode ? (
														<Input
															disabled={disableTwoFactor.isPending}
															onChange={field.onChange}
															placeholder='ABCDE-FGHIJ'
															value={field.value ?? ''}
														/>
													) : (
														<InputOTP
															disabled={disableTwoFactor.isPending}
															maxLength={6}
															onChange={(val) => field.onChange(val)}
															value={field.value || ''}
														>
															<InputOTPGroup>
																{Array.from({ length: 3 }).map((_, index) => (
																	<InputOTPSlot
																		index={index}
																		key={`disable-otp-${index}`}
																	/>
																))}
															</InputOTPGroup>
															<InputOTPSeparator />
															<InputOTPGroup>
																{Array.from({ length: 3 }).map((_, index) => (
																	<InputOTPSlot
																		index={index + 3}
																		key={`disable-otp-${index + 3}`}
																	/>
																))}
															</InputOTPGroup>
														</InputOTP>
													)}
													<div className='flex justify-between text-xs text-muted-foreground'>
														<button
															className='hover:text-primary'
															onClick={() => {
																setDisableUseRecoveryCode((prev) => !prev);
																disableForm.setValue('code', '');
																disableForm.clearErrors('code');
															}}
															type='button'
														>
															{disableUseRecoveryCode
																? 'Use authenticator code instead'
																: 'Use a recovery code instead'}
														</button>
														<span>
															{disableUseRecoveryCode
																? 'Recovery codes are 10 characters.'
																: 'Six digits from your authenticator app.'}
														</span>
													</div>
												</div>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<DialogFooter>
									<Button disabled={disableTwoFactor.isPending} type='submit' variant='destructive'>
										{disableTwoFactor.isPending && <Spinner className='mr-2' />}
										{disableTwoFactor.isPending ? 'Disabling…' : 'Disable two-factor'}
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

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CopyIcon } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { type ReactNode, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api } from '@/trpc/react';

type SetupPayload = {
	otpauthUrl: string;
	recoveryCodes: string[];
	secret: string;
};

const confirmSchema = z.object({
	code: z.string().min(6, 'Enter the 6-digit code from your authenticator app').max(20, 'Code is too long')
});

const verificationSchema = z.object({
	code: z.string().optional(),
	password: z.string().optional()
});

const regenVerificationSchema = verificationSchema.superRefine((data, ctx) => {
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

export default function TwoFactorCard() {
	const twoFactor = api.account.getTwoFactorState.useQuery();
	const startSetup = api.account.startTwoFactorSetup.useMutation({
		onError: (err) => toast.error(err.message || 'Failed to start setup'),
		onSuccess: (payload) => {
			setSetup(payload);
			setRegenCodes(null);
			twoFactor.refetch();
			toast.success('Two-factor setup started');
		}
	});
	const confirmSetup = api.account.confirmTwoFactorSetup.useMutation({
		onError: (err) => toast.error(err.message || 'Invalid authentication code'),
		onSuccess: () => {
			confirmForm.reset();
			setSetup(null);
			twoFactor.refetch();
			toast.success('Two-factor authentication enabled');
		}
	});
	const cancelSetup = api.account.cancelTwoFactorSetup.useMutation({
		onError: (err) => toast.error(err.message || 'Failed to cancel setup'),
		onSuccess: () => {
			setSetup(null);
			twoFactor.refetch();
			toast.success('Two-factor setup cleared');
		}
	});
	const disableTwoFactor = api.account.disableTwoFactor.useMutation({
		onError: (err) => toast.error(err.message || 'Failed to disable two-factor authentication'),
		onSuccess: () => {
			setDisableOpen(false);
			disableForm.reset();
			setSetup(null);
			setRegenCodes(null);
			twoFactor.refetch();
			toast.success('Two-factor authentication disabled');
		}
	});
	const regenerateRecoveryCodes = api.account.regenerateTwoFactorRecoveryCodes.useMutation({
		onError: (err) => toast.error(err.message || 'Failed to regenerate recovery codes'),
		onSuccess: (payload) => {
			setRegenOpen(false);
			regenForm.reset();
			setRegenCodes(payload.recoveryCodes);
			twoFactor.refetch();
			toast.success('New recovery codes generated');
		}
	});

	const confirmForm = useForm<z.infer<typeof confirmSchema>>({
		defaultValues: { code: '' },
		resolver: zodResolver(confirmSchema)
	});

	const disableForm = useForm<z.infer<typeof verificationSchema>>({
		defaultValues: { code: '', password: '' },
		resolver: zodResolver(verificationSchema)
	});

	const regenForm = useForm<z.infer<typeof regenVerificationSchema>>({
		defaultValues: { code: '', password: '' },
		resolver: zodResolver(regenVerificationSchema)
	});

	const [setup, setSetup] = useState<SetupPayload | null>(null);
	const [regenCodes, setRegenCodes] = useState<string[] | null>(null);
	const [disableOpen, setDisableOpen] = useState(false);
	const [regenOpen, setRegenOpen] = useState(false);
	const [disableUseRecoveryCode, setDisableUseRecoveryCode] = useState(false);
	const hasPassword = Boolean(twoFactor.data?.hasPassword);

	useEffect(() => {
		if (!twoFactor.data?.pending) {
			setSetup(null);
		}
		if (!twoFactor.data?.enabled) {
			setRegenCodes(null);
		}
	}, [twoFactor.data?.pending, twoFactor.data?.enabled]);

	useEffect(() => {
		if (!hasPassword) {
			disableForm.setValue('password', '');
			disableForm.clearErrors('password');
		}
	}, [hasPassword, disableForm]);

	useEffect(() => {
		if (!disableOpen) {
			setDisableUseRecoveryCode(false);
			disableForm.reset();
		}
	}, [disableOpen, disableForm]);

	const pendingSetup = twoFactor.data?.pending || Boolean(setup);
	const isEnabled = Boolean(twoFactor.data?.enabled);
	const displaySetup = setup;

	let body: ReactNode;

	if (twoFactor.isLoading) {
		body = <p className='text-muted-foreground text-sm'>Loading two-factor status…</p>;
	} else if (pendingSetup) {
		const setupDetails = displaySetup ? (
			<div className='grid gap-4 md:grid-cols-[minmax(0,320px)_1fr]'>
				<div className='flex items-center justify-center rounded-lg border bg-muted/30 p-4'>
					<QRCodeSVG className='h-auto w-52' value={displaySetup.otpauthUrl} />
				</div>
				<div className='space-y-4'>
					<div>
						<div className='flex items-center gap-2'>
							<p className='font-medium'>Setup key</p>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										className='size-8'
										onClick={async () => {
											try {
												await navigator.clipboard.writeText(displaySetup.secret);
												toast.success('Setup key copied');
											} catch {
												toast.error('Failed to copy setup key');
											}
										}}
										size='icon'
										variant='outline'
									>
										<CopyIcon className='size-3' />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Copy setup key</TooltipContent>
							</Tooltip>
						</div>
						<code className='mt-2 inline-block rounded border bg-muted/50 px-2 py-1 text-sm'>
							{displaySetup.secret}
						</code>
					</div>
					<div>
						<div className='flex items-center gap-2'>
							<p className='font-medium'>Recovery codes</p>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										className='size-8'
										onClick={async () => {
											try {
												await navigator.clipboard.writeText(
													displaySetup.recoveryCodes.join('\n')
												);
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
								<TooltipContent>Copy recovery codes</TooltipContent>
							</Tooltip>
						</div>
						<p className='mt-2 text-muted-foreground text-xs'>
							Store these in a safe place. Each can be used once.
						</p>
						<div className='mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3'>
							{displaySetup.recoveryCodes.map((code) => (
								<code
									className='rounded border bg-background px-2 py-1 text-center font-mono text-sm'
									key={code}
								>
									{code}
								</code>
							))}
						</div>
					</div>
				</div>
			</div>
		) : (
			<div className='rounded border border-dashed p-4 text-sm text-muted-foreground'>
				Setup details are not available. Generate a new QR code to restart the process.
			</div>
		);

		body = (
			<div className='space-y-4'>
				<p className='text-sm'>
					Scan this QR code with your authenticator app or enter the setup key manually. Then enter the first
					6-digit code to activate two-factor authentication.
				</p>
				{setupDetails}
				<Form {...confirmForm}>
					<form
						className='flex w-fit flex-col gap-3'
						onSubmit={confirmForm.handleSubmit((values) => {
							confirmSetup.mutate({ code: values.code.replace(/\s+/g, '') });
						})}
					>
						<FormField
							control={confirmForm.control}
							name='code'
							render={({ field }) => (
								<FormItem>
									<FormLabel>Authenticator code</FormLabel>
									<FormControl>
										<InputOTP
											autoFocus
											disabled={confirmSetup.isPending}
											maxLength={6}
											onChange={(val) => field.onChange(val)}
											value={field.value || ''}
										>
											<InputOTPGroup>
												{Array.from({ length: 3 }).map((_, index) => (
													<InputOTPSlot index={index} key={`confirm-otp-${index}`} />
												))}
											</InputOTPGroup>
											<InputOTPSeparator />
											<InputOTPGroup>
												{Array.from({ length: 3 }).map((_, index) => (
													<InputOTPSlot index={index + 3} key={`confirm-otp-${index + 3}`} />
												))}
											</InputOTPGroup>
										</InputOTP>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<Button className='w-full' disabled={confirmSetup.isPending} type='submit'>
							{confirmSetup.isPending ? 'Enabling…' : 'Confirm & enable'}
						</Button>
					</form>
				</Form>
				<div className='flex flex-wrap gap-2'>
					<Button disabled={startSetup.isPending} onClick={() => startSetup.mutate()} variant='outline'>
						{startSetup.isPending ? 'Refreshing…' : 'Generate new QR code'}
					</Button>
					<Button disabled={cancelSetup.isPending} onClick={() => cancelSetup.mutate()} variant='ghost'>
						Cancel setup
					</Button>
				</div>
			</div>
		);
	} else if (isEnabled) {
		body = (
			<div className='space-y-4'>
				<p className='text-sm text-green-600 dark:text-green-400'>
					Two-factor authentication is active on your account.
				</p>
				<p className='text-sm'>
					{twoFactor.data?.recoveryCodesRemaining
						? `${twoFactor.data.recoveryCodesRemaining} recovery code${
								twoFactor.data.recoveryCodesRemaining === 1 ? '' : 's'
							} remaining.`
						: 'No recovery codes remaining. Regenerate new codes before you need them.'}
				</p>
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
									Provide your password and an authentication/recovery code to confirm. New codes
									replace existing ones.
								</DialogDescription>
							</DialogHeader>
							<Form {...regenForm}>
								<form
									className='space-y-3'
									onSubmit={regenForm.handleSubmit((values) => {
										const code = (values.code ?? '').trim();
										const password = (values.password ?? '').trim();
										regenerateRecoveryCodes.mutate({ code, password });
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

										if (!code) {
											errors.push({ field: 'code', message: 'Enter your authenticator or recovery code.' });
										}
										if (hasPassword && rawPassword.length === 0) {
											errors.push({ field: 'password', message: 'Enter your password.' });
										}

										if (errors.length > 0) {
											errors.forEach((err) => disableForm.setError(err.field, { message: err.message, type: 'manual' }));
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
																autoComplete='one-time-code'
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
										<Button
											disabled={disableTwoFactor.isPending}
											type='submit'
											variant='destructive'
										>
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
	} else {
		body = (
			<div className='space-y-4'>
				<p className='text-sm'>Protect your account with an authenticator app or phone-based code.</p>
				<Button disabled={startSetup.isPending} onClick={() => startSetup.mutate()}>
					{startSetup.isPending ? 'Preparing…' : 'Enable two-factor authentication'}
				</Button>
			</div>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Two-factor authentication</CardTitle>
				<CardDescription>Add a second factor to your login for better account security.</CardDescription>
			</CardHeader>
			<CardContent className='space-y-4'>{body}</CardContent>
		</Card>
	);
}

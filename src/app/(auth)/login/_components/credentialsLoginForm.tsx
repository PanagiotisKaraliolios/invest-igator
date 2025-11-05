'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp';
import { authClient } from '@/lib/auth-client';

export function CredentialsLoginForm() {
	const router = useRouter();
	const sp = useSearchParams();
	const callbackUrl = sp.get('callbackUrl') ?? '/portfolio';

	const [showPassword, setShowPassword] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [otpError, setOtpError] = useState<string | null>(null);
	const [otpOpen, setOtpOpen] = useState(false);
	const [pendingCreds, setPendingCreds] = useState<{ email: string; password: string } | null>(null);
	const [useRecoveryCode, setUseRecoveryCode] = useState(false);
	const [trustDevice, setTrustDevice] = useState(false);

	useEffect(() => {
		if (!otpOpen) {
			setOtpError(null);
			setUseRecoveryCode(false);
			setTrustDevice(false);
		}
	}, [otpOpen]);

	const schema = z.object({
		email: z.string().email('Enter a valid email'),
		password: z.string().min(1, 'Password is required')
	});

	const otpSchema = z.object({
		otp: z
			.string()
			.min(6, 'Enter the code from your authenticator app or recovery code')
			.max(64, 'Code is too long')
	});

	const {
		clearErrors,
		formState: { errors, isSubmitting },
		handleSubmit,
		register,
		setError: setFormError
	} = useForm<z.infer<typeof schema>>({
		defaultValues: { email: '', password: '' },
		resolver: zodResolver(schema)
	});

	const otpForm = useForm<z.infer<typeof otpSchema>>({
		defaultValues: { otp: '' },
		resolver: zodResolver(otpSchema)
	});

	async function onSubmit(values: z.infer<typeof schema>) {
		setError(null);
		try {
			const result = await authClient.signIn.email({
				callbackURL: callbackUrl,
				email: values.email.trim().toLowerCase(),
				password: values.password
			});

			// Check for 2FA requirement - Better Auth sets twoFactorRedirect in data
			// Using 'in' operator as TypeScript doesn't infer this property
			if (result.data && 'twoFactorRedirect' in result.data && result.data.twoFactorRedirect) {
				setPendingCreds({
					email: values.email.trim().toLowerCase(),
					password: values.password
				});
				otpForm.reset();
				setOtpError(null);
				setUseRecoveryCode(false);
				setOtpOpen(true);
				clearErrors();
				return;
			}

			// Handle other errors
			if (result.error) {
				const message = result.error.message || 'Invalid email or password.';
				setFormError('email', { message, type: 'manual' });
				setFormError('password', { message: ' ', type: 'manual' });
				setError(message);
				return;
			}

			// Success - redirect
			router.replace(callbackUrl);
		} catch (err) {
			setError('Something went wrong. Please try again.');
		}
	}

	async function onSubmitOtp(values: z.infer<typeof otpSchema>) {
		setOtpError(null);
		const creds = pendingCreds;
		if (!creds) {
			setOtpOpen(false);
			return;
		}
		try {
			const raw = values.otp.trim();
			const normalized = useRecoveryCode
				? raw.replace(/[^0-9a-z]/gi, '').toUpperCase()
				: raw.replace(/[^0-9]/g, '');
			if (!useRecoveryCode && normalized.length !== 6) {
				const message = 'Enter the 6-digit code from your authenticator app.';
				otpForm.setError('otp', { message, type: 'manual' });
				return;
			}
			if (useRecoveryCode && normalized.length < 10) {
				const message = 'Recovery codes are 10 characters long.';
				otpForm.setError('otp', { message, type: 'manual' });
				return;
			}

			// Better Auth 2FA verification - use different methods for TOTP vs backup codes
			const result = useRecoveryCode
				? await authClient.twoFactor.verifyBackupCode({
						code: raw,
						trustDevice
					})
				: await authClient.twoFactor.verifyTotp({
						code: normalized,
						trustDevice
					});

			if (result.error) {
				const message = useRecoveryCode
					? 'Invalid recovery code. Try again or use an authenticator code.'
					: 'Invalid authentication code. Try again or use a recovery code.';
				otpForm.setError('otp', { message, type: 'manual' });
				setOtpError(null);
				otpForm.setFocus('otp');
				return;
			}

			// Success - redirect
			setOtpOpen(false);
			router.replace(callbackUrl);
		} catch {
			setOtpError('Something went wrong. Please try again.');
		}
	}

	return (
		<>
			<form onSubmit={handleSubmit(onSubmit)}>
				<div className='grid gap-6'>
					{error ? (
						<Alert variant='destructive'>
							<AlertTitle>Sign-in failed</AlertTitle>
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					) : null}
					<Field data-invalid={!!errors.email}>
						<FieldLabel htmlFor='cred-email'>Email</FieldLabel>
						<Input
							aria-invalid={!!errors.email}
							data-testid='cred-email'
							disabled={isSubmitting}
							id='cred-email'
							placeholder='m@example.com'
							type='email'
							{...register('email')}
						/>
						<FieldError errors={[errors.email]} />
					</Field>
					<Field data-invalid={!!errors.password}>
						<div className='flex items-center'>
							<FieldLabel htmlFor='cred-password'>Password</FieldLabel>
							<Link
								className='ml-auto text-sm underline-offset-4 hover:underline'
								href='/forgot-password'
							>
								Forgot your password?
							</Link>
						</div>
						<InputGroup>
							<InputGroupInput
								aria-invalid={!!errors.password}
								data-testid='cred-password'
								disabled={isSubmitting}
								id='cred-password'
								type={showPassword ? 'text' : 'password'}
								{...register('password')}
							/>
							<InputGroupAddon align='inline-end'>
								<InputGroupButton
									aria-label={showPassword ? 'Hide password' : 'Show password'}
									data-testid='toggle-password-visibility'
									onClick={() => setShowPassword((s) => !s)}
									size='icon-xs'
									variant='ghost'
								>
									{showPassword ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
								</InputGroupButton>
							</InputGroupAddon>
						</InputGroup>
						<FieldError errors={[errors.password]} />
					</Field>
					<Button className='w-full' data-testid='cred-submit' disabled={isSubmitting} type='submit'>
						{isSubmitting ? 'Logging in…' : 'Login'}
					</Button>
				</div>
			</form>
			<Dialog onOpenChange={(open) => setOtpOpen(open)} open={otpOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Two-factor authentication</DialogTitle>
						<DialogDescription>
							Enter the code from your authenticator app or one of your recovery codes to finish signing
							in.
						</DialogDescription>
					</DialogHeader>
					<form className='space-y-4' onSubmit={otpForm.handleSubmit(onSubmitOtp)}>
						<Field data-invalid={!!otpForm.formState.errors.otp}>
							<FieldLabel htmlFor='otp-input'>Authentication code</FieldLabel>
							<div className='space-y-2'>
								{useRecoveryCode ? (
									<Input
										aria-invalid={!!otpForm.formState.errors.otp}
										autoComplete='one-time-code'
										disabled={otpForm.formState.isSubmitting}
										id='otp-input'
										placeholder='ABCDE-FGHIJ'
										{...otpForm.register('otp')}
									/>
								) : (
									<Controller
										control={otpForm.control}
										name='otp'
										render={({ field }) => (
											<InputOTP
												autoFocus
												disabled={otpForm.formState.isSubmitting}
												maxLength={6}
												onChange={field.onChange}
												value={field.value || ''}
											>
												<InputOTPGroup>
													{Array.from({ length: 3 }).map((_, index) => (
														<InputOTPSlot index={index} key={`otp-${index}`} />
													))}
												</InputOTPGroup>
												<InputOTPSeparator />
												<InputOTPGroup>
													{Array.from({ length: 3 }).map((_, index) => (
														<InputOTPSlot index={index + 3} key={`otp-${index + 3}`} />
													))}
												</InputOTPGroup>
											</InputOTP>
										)}
									/>
								)}
								<div className='flex justify-between text-xs text-muted-foreground'>
									<button
										className='hover:text-primary'
										onClick={() => {
											setUseRecoveryCode((prev) => !prev);
											otpForm.reset();
											setOtpError(null);
										}}
										type='button'
									>
										{useRecoveryCode
											? 'Use authenticator code instead'
											: 'Use a recovery code instead'}
									</button>
									<span>
										{useRecoveryCode
											? 'Recovery codes are 10 characters.'
											: 'Six digits from your authenticator app.'}
									</span>
								</div>
							</div>
							<FieldError errors={[otpForm.formState.errors.otp]} />
						</Field>
						{otpError && !otpForm.formState.errors.otp ? (
							<p className='text-destructive text-sm'>{otpError}</p>
						) : null}
						<div className='flex items-center space-x-2'>
							<Checkbox
								checked={trustDevice}
								id='trust-device'
								onCheckedChange={(checked) => setTrustDevice(checked === true)}
							/>
							<label
								className='text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
								htmlFor='trust-device'
							>
								Trust this device for 30 days
							</label>
						</div>
						<DialogFooter>
							<Button disabled={otpForm.formState.isSubmitting} type='submit'>
								{otpForm.formState.isSubmitting ? 'Verifying…' : 'Verify code'}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}

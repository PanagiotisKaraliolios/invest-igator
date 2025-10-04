'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp';

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

	useEffect(() => {
		if (!otpOpen) {
			setOtpError(null);
			setUseRecoveryCode(false);
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

	const form = useForm<z.infer<typeof schema>>({
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
			const result = await signIn('credentials', {
				callbackUrl,
				email: values.email.trim().toLowerCase(),
				password: values.password,
				redirect: false
			});

			// Success: NextAuth returns a URL when redirect is false. Fallback to callbackUrl.
			if (!result?.error && (result?.url || result?.ok)) {
				router.replace(result.url ?? callbackUrl);
				return;
			}

			// Normalize error message
			const code = result?.code ?? result?.error;
			if (code === 'two_factor_required' || code === 'TwoFactorRequired') {
				setPendingCreds({
					email: values.email.trim().toLowerCase(),
					password: values.password
				});
				otpForm.reset();
				setOtpError(null);
				setUseRecoveryCode(false);
				setOtpOpen(true);
				form.clearErrors();
				return;
			}
			if (code === 'invalid_two_factor_code' || code === 'InvalidTwoFactorCode') {
				// Should not reach here without opening modal, but handle defensively
				setPendingCreds({
					email: values.email.trim().toLowerCase(),
					password: values.password
				});
				otpForm.reset();
				setOtpError(null);
				setUseRecoveryCode(false);
				setOtpOpen(true);
				return;
			}
			const message =
				code === 'CredentialsSignin' || code === 'invalid_credentials' || code === 'Invalid Email or Password'
					? 'Invalid email or password.'
					: code || 'Invalid email or password.';
			// Optionally surface on the form fields as well
			form.setError('email', { message, type: 'manual' });
			form.setError('password', { message: ' ', type: 'manual' });
			setError(message);
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
			const result = await signIn('credentials', {
				callbackUrl,
				email: creds.email,
				otp: normalized,
				password: creds.password,
				redirect: false
			});

			if (!result?.error && (result?.url || result?.ok)) {
				setOtpOpen(false);
				router.replace(result.url ?? callbackUrl);
				return;
			}

			const code = result?.code ?? result?.error;
			if (code === 'invalid_two_factor_code' || code === 'InvalidTwoFactorCode') {
				const message = 'Invalid authentication code. Try again or use a recovery code.';
				otpForm.setError('otp', { message, type: 'manual' });
				setOtpError(null);
				otpForm.setFocus('otp');
				return;
			}

			const message = code || 'Unable to complete sign-in. Please try again.';
			setOtpError(message);
		} catch {
			setOtpError('Something went wrong. Please try again.');
		}
	}

	return (
		<Form {...form}>
			<form onSubmit={form.handleSubmit(onSubmit)}>
				<div className='grid gap-6'>
					{error ? (
						<Alert variant='destructive'>
							<AlertTitle>Sign-in failed</AlertTitle>
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					) : null}
					<FormField
						control={form.control}
						name='email'
						render={({ field }) => (
							<FormItem>
								<FormLabel htmlFor='cred-email'>Email</FormLabel>
								<FormControl>
									<Input
										data-testid='cred-email'
										disabled={form.formState.isSubmitting}
										id='cred-email'
										placeholder='m@example.com'
										type='email'
										{...field}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name='password'
						render={({ field }) => (
							<FormItem>
								<div className='flex items-center'>
									<FormLabel htmlFor='cred-password'>Password</FormLabel>
									<Link
										className='ml-auto text-sm underline-offset-4 hover:underline'
										href='/forgot-password'
									>
										Forgot your password?
									</Link>
								</div>
								<FormControl>
									<InputGroup>
										<InputGroupInput
											data-testid='cred-password'
											disabled={form.formState.isSubmitting}
											id='cred-password'
											type={showPassword ? 'text' : 'password'}
											{...field}
										/>
										<InputGroupAddon align='inline-end'>
											<InputGroupButton
												aria-label={showPassword ? 'Hide password' : 'Show password'}
												data-testid='toggle-password-visibility'
												onClick={() => setShowPassword((s) => !s)}
												size='icon-xs'
												variant='ghost'
											>
												{showPassword ? (
													<EyeOff className='h-4 w-4' />
												) : (
													<Eye className='h-4 w-4' />
												)}
											</InputGroupButton>
										</InputGroupAddon>
									</InputGroup>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<Button
						className='w-full'
						data-testid='cred-submit'
						disabled={form.formState.isSubmitting}
						type='submit'
					>
						{form.formState.isSubmitting ? 'Logging in…' : 'Login'}
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
					<Form {...otpForm}>
						<form className='space-y-4' onSubmit={otpForm.handleSubmit(onSubmitOtp)}>
							<FormField
								control={otpForm.control}
								name='otp'
								render={({ field }) => (
									<FormItem>
										<FormLabel htmlFor='otp-input'>Authentication code</FormLabel>
										<FormControl>
											<div className='space-y-2'>
												{useRecoveryCode ? (
													<Input
														autoComplete='one-time-code'
														disabled={otpForm.formState.isSubmitting}
														id='otp-input'
														onChange={field.onChange}
														placeholder='ABCDE-FGHIJ'
														value={field.value ?? ''}
													/>
												) : (
													<InputOTP
														autoFocus
														disabled={otpForm.formState.isSubmitting}
														maxLength={6}
														onChange={(val) => field.onChange(val)}
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
																<InputOTPSlot
																	index={index + 3}
																	key={`otp-${index + 3}`}
																/>
															))}
														</InputOTPGroup>
													</InputOTP>
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
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							{otpError && !otpForm.formState.errors.otp ? (
								<p className='text-destructive text-sm'>{otpError}</p>
							) : null}
							<DialogFooter>
								<Button disabled={otpForm.formState.isSubmitting} type='submit'>
									{otpForm.formState.isSubmitting ? 'Verifying…' : 'Verify code'}
								</Button>
							</DialogFooter>
						</form>
					</Form>
				</DialogContent>
			</Dialog>
		</Form>
	);
}

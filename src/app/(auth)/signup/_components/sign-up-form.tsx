'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api } from '@/trpc/react';

const schema = z
	.object({
		confirmPassword: z.string(),
		email: z.email(),
		name: z.string().min(2, 'Name must be at least 2 characters'),
		password: z
			.string()
			.min(8, 'Password must be at least 8 characters')
			.regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, 'Use letters and numbers')
	})
	.refine((vals) => vals.password === vals.confirmPassword, {
		message: 'Passwords do not match',
		path: ['confirmPassword']
	});

export function SignUpForm() {
	const router = useRouter();
	const form = useForm<z.infer<typeof schema>>({
		defaultValues: { confirmPassword: '', email: '', name: '', password: '' },
		resolver: zodResolver(schema)
	});

	const [info, setInfo] = useState<string | null>(null);
	const [countdown, setCountdown] = useState<number | null>(null);
	const [showPassword, setShowPassword] = useState(false);
	const [showConfirmPassword, setShowConfirmPassword] = useState(false);

	const signupMutation = api.auth.signup.useMutation();

	async function onSubmit(values: z.infer<typeof schema>) {
		setInfo(null);
		try {
			await signupMutation.mutateAsync(values);
			setInfo('Account created. Check your email for a sign-in link.');
			setCountdown(3);
			await signIn('nodemailer', { email: values.email, redirect: false });
		} catch (err) {
			const message = (err as { message?: string })?.message ?? 'Failed to create account';
			if (message.includes('already exists')) {
				form.setError('email', { message, type: 'manual' });
			} else {
				form.setError('name', { message, type: 'manual' });
			}
		}
	}

	useEffect(() => {
		if (countdown === null) return;
		if (countdown <= 0) {
			router.push('/login');
			return;
		}
		const t = setTimeout(() => setCountdown((c) => (c ?? 0) - 1), 1000);
		return () => clearTimeout(t);
	}, [countdown, router]);

	return (
		<Card>
			<CardHeader className='text-center'>
				<CardTitle className='text-xl'>Create your account</CardTitle>
				<CardDescription>Sign up with your name and email</CardDescription>
			</CardHeader>
			<CardContent>
				<Form {...form}>
					<form className='space-y-4' onSubmit={form.handleSubmit(onSubmit)}>
						<FormField
							control={form.control}
							name='name'
							render={({ field }) => (
								<FormItem>
									<FormLabel>Name</FormLabel>
									<FormControl>
										<Input placeholder='Jane Doe' {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name='email'
							render={({ field }) => (
								<FormItem>
									<FormLabel>Email</FormLabel>
									<FormControl>
										<Input placeholder='jane@example.com' {...field} />
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
									<FormLabel>Password</FormLabel>
									<FormControl>
										<div className='relative'>
											<Input
												className='pr-10'
												placeholder='••••••••'
												type={showPassword ? 'text' : 'password'}
												{...field}
											/>
											<button
												aria-label={showPassword ? 'Hide password' : 'Show password'}
												className='absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground'
												onClick={() => setShowPassword((s) => !s)}
												type='button'
											>
												{showPassword ? (
													<EyeOff className='h-4 w-4' />
												) : (
													<Eye className='h-4 w-4' />
												)}
											</button>
										</div>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name='confirmPassword'
							render={({ field }) => (
								<FormItem>
									<FormLabel>Confirm password</FormLabel>
									<FormControl>
										<div className='relative'>
											<Input
												className='pr-10'
												placeholder='••••••••'
												type={showConfirmPassword ? 'text' : 'password'}
												{...field}
											/>
											<button
												aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
												className='absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground'
												onClick={() => setShowConfirmPassword((s) => !s)}
												type='button'
											>
												{showConfirmPassword ? (
													<EyeOff className='h-4 w-4' />
												) : (
													<Eye className='h-4 w-4' />
												)}
											</button>
										</div>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						{info ? (
							<div className='rounded bg-muted/50 p-3 text-sm'>
								{info}
								{countdown !== null ? (
									<div className='mt-1'>Redirecting to login in {countdown}s…</div>
								) : null}
							</div>
						) : null}
						<Button
							className='h-auto w-full whitespace-normal break-words leading-tight'
							disabled={signupMutation.isPending}
							type='submit'
						>
							{signupMutation.isPending ? 'Creating…' : 'Create account'}
						</Button>
					</form>
				</Form>
			</CardContent>
		</Card>
	);
}

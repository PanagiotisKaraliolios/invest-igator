'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import Link from 'next/link';

export function CredentialsLoginForm() {
	const router = useRouter();
	const sp = useSearchParams();
	const callbackUrl = sp.get('callbackUrl') ?? '/dashboard';

	const [showPassword, setShowPassword] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const schema = z.object({
		email: z.string().email('Enter a valid email'),
		password: z.string().min(1, 'Password is required')
	});

	const form = useForm<z.infer<typeof schema>>({
		defaultValues: { email: '', password: '' },
		resolver: zodResolver(schema)
	});

	async function onSubmit(values: z.infer<typeof schema>) {
		setError(null);
		try {
			const result = await signIn('credentials', {
				email: values.email.trim().toLowerCase(),
				password: values.password,
				redirect: false,
				callbackUrl,
			});

			// Success: NextAuth returns a URL when redirect is false. Fallback to callbackUrl.
			if (!result?.error && (result?.url || result?.ok)) {
				router.replace(result.url ?? callbackUrl);
				return;
			}

			// Normalize error message
			const code = result?.error;
			const message =
				code === 'CredentialsSignin' || code === 'Invalid Email or Password'
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
									<div className='relative'>
										<Input
											className='pr-10'
											data-testid='cred-password'
											disabled={form.formState.isSubmitting}
											id='cred-password'
											type={showPassword ? 'text' : 'password'}
											{...field}
										/>
										<button
											aria-label={showPassword ? 'Hide password' : 'Show password'}
											className='absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground'
											data-testid='toggle-password-visibility'
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
		</Form>
	);
}

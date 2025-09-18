'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function CredentialsLoginForm() {
	const router = useRouter();
	const sp = useSearchParams();
	const callbackUrl = sp.get('callbackUrl') ?? '/dashboard';

	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [showPassword, setShowPassword] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		if (!email || !password) {
			setError('Email and password are required.');
			return;
		}
		setSubmitting(true);
		try {
			const result = await signIn('credentials', {
				email: email.trim().toLowerCase(),
				password,
				redirect: false
				// callbackUrl,
			});

			console.log('credentials signIn result:', result);

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
			setError(message);
		} catch (err) {
			setError('Something went wrong. Please try again.');
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<form onSubmit={onSubmit}>
			<div className='grid gap-6'>
				{error ? (
					<Alert variant='destructive'>
						<AlertTitle>Sign-in failed</AlertTitle>
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				) : null}
				<div className='grid gap-3'>
					<Label htmlFor='cred-email'>Email</Label>
					<Input
						data-testid='cred-email'
						disabled={submitting}
						id='cred-email'
						onChange={(e) => setEmail(e.target.value)}
						placeholder='m@example.com'
						required
						type='email'
						value={email}
					/>
				</div>
				<div className='grid gap-3'>
					<div className='flex items-center'>
						<Label htmlFor='cred-password'>Password</Label>
						<a className='ml-auto text-sm underline-offset-4 hover:underline' href='/forgot-password'>
							Forgot your password?
						</a>
					</div>
					<div className='relative'>
						<Input
							className='pr-10'
							data-testid='cred-password'
							disabled={submitting}
							id='cred-password'
							onChange={(e) => setPassword(e.target.value)}
							required
							type={showPassword ? 'text' : 'password'}
							value={password}
						/>
						<button
							aria-label={showPassword ? 'Hide password' : 'Show password'}
							className='absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground'
							data-testid='toggle-password-visibility'
							onClick={() => setShowPassword((s) => !s)}
							type='button'
						>
							{showPassword ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
						</button>
					</div>
				</div>
				<Button className='w-full' data-testid='cred-submit' disabled={submitting} type='submit'>
					{submitting ? 'Logging in…' : 'Login'}
				</Button>
			</div>
		</form>
	);
}

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';

export function MagicLinkLoginForm() {
	const router = useRouter();
	const sp = useSearchParams();
	const callbackUrl = sp.get('callbackUrl') ?? '/portfolio';

	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	const schema = z.object({
		email: z.email('Enter a valid email')
	});

	const {
		formState: { errors, isSubmitting },
		handleSubmit,
		register,
		reset,
		setError: setFormError
	} = useForm<z.infer<typeof schema>>({
		defaultValues: { email: '' },
		resolver: zodResolver(schema)
	});

	async function onSubmit(values: z.infer<typeof schema>) {
		setError(null);
		setSuccess(false);

		try {
			const result = await authClient.signIn.magicLink({
				callbackURL: callbackUrl,
				email: values.email.trim().toLowerCase(),
				errorCallbackURL: `/login?error=magic-link-failed&callbackUrl=${encodeURIComponent(callbackUrl)}`,
				newUserCallbackURL: '/portfolio'
			});

			if (result.error) {
				const message = result.error.message || 'Failed to send magic link. Please try again.';
				setFormError('email', { message, type: 'manual' });
				setError(message);
				return;
			}

			// Success - show confirmation message
			setSuccess(true);
			reset();
		} catch (err) {
			setError('Something went wrong. Please try again.');
		}
	}

	if (success) {
		return (
			<Alert>
				<AlertTitle>Check your email</AlertTitle>
				<AlertDescription>We sent you a magic link. Click the link in your email to sign in.</AlertDescription>
			</Alert>
		);
	}

	return (
		<form className='grid gap-4' onSubmit={handleSubmit(onSubmit)}>
			{error && (
				<Alert variant='destructive'>
					<AlertTitle>Error</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			<Field data-invalid={!!errors.email}>
				<FieldLabel htmlFor='magic-link-email'>Email</FieldLabel>
				<Input
					aria-invalid={!!errors.email}
					autoComplete='email'
					data-testid='magic-link-email-input'
					disabled={isSubmitting}
					id='magic-link-email'
					placeholder='name@example.com'
					type='email'
					{...register('email')}
				/>
				<FieldError errors={[errors.email]} />
			</Field>

			<Button className='w-full' data-testid='magic-link-submit-button' disabled={isSubmitting} type='submit'>
				{isSubmitting ? 'Sending magic link...' : 'Send magic link'}
			</Button>
		</form>
	);
}

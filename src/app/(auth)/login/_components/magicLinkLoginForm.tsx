'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';

export function MagicLinkLoginForm() {
	const router = useRouter();
	const sp = useSearchParams();
	const callbackUrl = sp.get('callbackUrl') ?? '/portfolio';

	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	const schema = z.object({
		email: z.string().email('Enter a valid email')
	});

	const form = useForm<z.infer<typeof schema>>({
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
				form.setError('email', { message, type: 'manual' });
				setError(message);
				return;
			}

			// Success - show confirmation message
			setSuccess(true);
			form.reset();
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
		<Form {...form}>
			<form className='grid gap-4' onSubmit={form.handleSubmit(onSubmit)}>
				{error && (
					<Alert variant='destructive'>
						<AlertTitle>Error</AlertTitle>
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}

				<FormField
					control={form.control}
					name='email'
					render={({ field }) => (
						<FormItem>
							<FormLabel>Email</FormLabel>
							<FormControl>
								<Input
									autoComplete='email'
									data-testid='magic-link-email-input'
									disabled={form.formState.isSubmitting}
									placeholder='name@example.com'
									type='email'
									{...field}
								/>
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>

				<Button
					className='w-full'
					data-testid='magic-link-submit-button'
					disabled={form.formState.isSubmitting}
					type='submit'
				>
					{form.formState.isSubmitting ? 'Sending magic link...' : 'Send magic link'}
				</Button>
			</form>
		</Form>
	);
}

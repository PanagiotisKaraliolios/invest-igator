'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { requestPasswordReset } from '@/lib/auth-client';

const schema = z.object({
	email: z.string().email('Enter a valid email')
});

type FormValues = z.infer<typeof schema>;

function ForgotPasswordRequestForm() {
	const [submitted, setSubmitted] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const {
		formState: { errors },
		handleSubmit,
		register,
		reset
	} = useForm<FormValues>({
		defaultValues: { email: '' },
		resolver: zodResolver(schema)
	});

	async function onSubmit(values: FormValues) {
		setIsLoading(true);
		try {
			const result = await requestPasswordReset({
				email: values.email,
				redirectTo: '/forgot-password/reset'
			});
			if (result.error?.message) {
				toast.error(result.error.message);
				return;
			}
			setSubmitted(true);
			toast.success(result.data?.message ?? "If an account exists, we've sent a reset link.");
			reset();
		} catch (error) {
			toast.error(`Something went wrong. Please try again. ${error instanceof Error ? error.message : ''}`);
		} finally {
			setIsLoading(false);
		}
	}

	if (submitted) {
		return (
			<p className='text-sm text-muted-foreground' data-testid='forgot-success-message'>
				If an account exists for that email, a reset link has been sent.
			</p>
		);
	}

	return (
		<form className='space-y-4' data-testid='forgot-form' onSubmit={handleSubmit(onSubmit)}>
			<Field data-invalid={!!errors.email}>
				<FieldLabel htmlFor='forgot-email'>Email</FieldLabel>
				<Input
					aria-invalid={!!errors.email}
					data-testid='forgot-email'
					id='forgot-email'
					placeholder='you@example.com'
					type='email'
					{...register('email')}
				/>
				<FieldError errors={[errors.email]} />
			</Field>
			<Button className='w-full' data-testid='forgot-submit' disabled={isLoading} type='submit'>
				{isLoading && <Spinner className='mr-2' />}
				{isLoading ? 'Sending…' : 'Send reset link'}
			</Button>
		</form>
	);
}

export default ForgotPasswordRequestForm;

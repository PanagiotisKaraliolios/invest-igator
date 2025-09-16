'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api } from '@/trpc/react';

const formSchema = z.object({
	email: z.email()
});

export function EmailProviderLoginForm() {
	const searchParams = useSearchParams();

	const callbackUrl = searchParams.get('callbackUrl') ?? '/dashboard';

	// 1. Define your form.
	const form = useForm<z.infer<typeof formSchema>>({
		defaultValues: {
			email: ''
		},
		resolver: zodResolver(formSchema)
	});

	const [info, setInfo] = useState<string | null>(null);

	const checkEmailMutation = api.auth.checkEmail.useMutation();

	// 2. Define a submit handler.
	async function onSubmit(values: z.infer<typeof formSchema>) {
		setInfo(null);
		try {
			const data = await checkEmailMutation.mutateAsync(values.email);
			if (!data?.exists) {
				form.setError('email', {
					message: 'No account found for this email. Create an account first.',
					type: 'manual'
				});
				return;
			}
			await signIn('nodemailer', {
				callbackUrl,
				email: values.email
			});
		} catch (e) {
			form.setError('email', {
				message: (e as { message?: string })?.message ?? 'Something went wrong. Please try again.',
				type: 'manual'
			});
		}
	}

	return (
		<Form {...form}>
			<form className='space-y-4' onSubmit={form.handleSubmit(onSubmit)}>
				<FormField
					control={form.control}
					name='email'
					render={({ field }) => (
						<FormItem>
							<FormLabel>Email</FormLabel>
							<FormControl>
								<Input placeholder='m@example.com' {...field} />
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
				<Button
					className='h-auto w-full whitespace-normal break-words leading-tight'
					disabled={checkEmailMutation.isPending}
					type='submit'
				>
					{checkEmailMutation.isPending ? 'Sending…' : 'Get one-time login link'}
				</Button>
				{info ? <div className='rounded bg-muted/50 p-3 text-sm'>{info}</div> : null}
			</form>
		</Form>
	);
}

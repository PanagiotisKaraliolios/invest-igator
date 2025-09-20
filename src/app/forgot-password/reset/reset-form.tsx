'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api } from '@/trpc/react';

const schema = z
	.object({
		confirm: z.string(),
		password: z
			.string()
			.min(8, 'At least 8 characters')
			.regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, 'Use letters and numbers')
	})
	.refine((val) => val.password === val.confirm, {
		message: "Passwords don't match",
		path: ['confirm']
	});

type FormValues = z.infer<typeof schema>;

function ResetPasswordForm({ token }: { token: string }) {
	const [showNew, setShowNew] = useState(false);
	const [showConfirm, setShowConfirm] = useState(false);
	const router = useRouter();
	const form = useForm<FormValues>({
		defaultValues: { confirm: '', password: '' },
		resolver: zodResolver(schema)
	});

	const mutation = api.auth.resetPassword.useMutation({
		onError: (err) => {
			const msg = err?.message || 'Reset link is invalid or expired';
			toast.error(msg);
		},
		onSuccess: () => {
			toast.success('Password updated. You can now sign in.');
			router.push('/login');
		}
	});

	function onSubmit(values: FormValues) {
		mutation.mutate({ password: values.password, token });
	}

	return (
		<Form {...form}>
			<form className='space-y-4' data-testid='reset-form' onSubmit={form.handleSubmit(onSubmit)}>
				<FormField
					control={form.control}
					name='password'
					render={({ field }) => (
						<FormItem>
							<FormLabel>New password</FormLabel>
							<FormControl>
								<div className='relative'>
									<Input
										autoComplete='new-password'
										type={showNew ? 'text' : 'password'}
										{...field}
										data-testid='reset-password'
									/>
									<button
										aria-label={showNew ? 'Hide password' : 'Show password'}
										className='absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground'
										data-testid='reset-toggle-new'
										onClick={() => setShowNew((s) => !s)}
										type='button'
									>
										{showNew ? <EyeOff size={18} /> : <Eye size={18} />}
									</button>
								</div>
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name='confirm'
					render={({ field }) => (
						<FormItem>
							<FormLabel>Confirm password</FormLabel>
							<FormControl>
								<div className='relative'>
									<Input
										autoComplete='new-password'
										type={showConfirm ? 'text' : 'password'}
										{...field}
										data-testid='reset-confirm'
									/>
									<button
										aria-label={showConfirm ? 'Hide password' : 'Show password'}
										className='absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground'
										data-testid='reset-toggle-confirm'
										onClick={() => setShowConfirm((s) => !s)}
										type='button'
									>
										{showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
									</button>
								</div>
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>

				<Button className='w-full' data-testid='reset-submit' disabled={mutation.isPending} type='submit'>
					{mutation.isPending ? 'Updating…' : 'Update password'}
				</Button>
			</form>
		</Form>
	);
}

export default ResetPasswordForm;

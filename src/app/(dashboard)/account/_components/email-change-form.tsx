'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/trpc/react';

export type EmailChangeFormProps = { onDone?: () => void };

const emailChangeSchema = z.object({
	currentPassword: z.string().optional(),
	newEmail: z.email('Enter a valid email')
});
type EmailChangeFormInput = z.infer<typeof emailChangeSchema>;

export function EmailChangeForm({ onDone }: EmailChangeFormProps) {
	const form = useForm<EmailChangeFormInput>({
		defaultValues: { currentPassword: '', newEmail: '' },
		resolver: zodResolver(emailChangeSchema)
	});

	const request = api.account.requestEmailChange.useMutation({
		onError: (e) => toast.error(e.message || 'Failed to start email change'),
		onSuccess: () => {
			form.reset({ currentPassword: '', newEmail: '' });
			toast.success('Check your new email for a confirmation link');
			onDone?.();
		}
	});

	return (
		<Form {...form}>
			<form
				className='space-y-3'
				onSubmit={form.handleSubmit((vals) =>
					request.mutate({
						currentPassword: vals.currentPassword?.trim() || undefined,
						newEmail: vals.newEmail.trim()
					})
				)}
			>
				<FormField
					control={form.control}
					name='newEmail'
					render={({ field }) => (
						<FormItem>
							<FormLabel>New email</FormLabel>
							<FormControl>
								<Input
									disabled={request.isPending}
									id='new-email'
									onChange={field.onChange}
									type='email'
									value={field.value ?? ''}
								/>
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>

				<FormField
					control={form.control}
					name='currentPassword'
					render={({ field }) => (
						<FormItem>
							<FormLabel>Current password (if set)</FormLabel>
							<FormControl>
								<Input
									disabled={request.isPending}
									id='curr-pass'
									onChange={field.onChange}
									type='password'
									value={field.value ?? ''}
								/>
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>

				<div className='flex justify-end gap-2'>
					<Button disabled={request.isPending} type='submit'>
						{request.isPending && <Spinner className='mr-2' />}
						Send confirmation link
					</Button>
				</div>
			</form>
		</Form>
	);
}

export default EmailChangeForm;

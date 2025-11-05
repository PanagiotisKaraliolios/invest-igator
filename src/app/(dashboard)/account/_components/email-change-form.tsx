'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
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
	const {
		formState: { errors },
		handleSubmit,
		register,
		reset
	} = useForm<EmailChangeFormInput>({
		defaultValues: { currentPassword: '', newEmail: '' },
		resolver: zodResolver(emailChangeSchema)
	});

	const request = api.account.requestEmailChange.useMutation({
		onError: (e) => toast.error(e.message || 'Failed to start email change'),
		onSuccess: () => {
			reset({ currentPassword: '', newEmail: '' });
			toast.success('Check your new email for a confirmation link');
			onDone?.();
		}
	});

	return (
		<form
			className='space-y-3'
			onSubmit={handleSubmit((vals) =>
				request.mutate({
					currentPassword: vals.currentPassword?.trim() || undefined,
					newEmail: vals.newEmail.trim()
				})
			)}
		>
			<Field data-invalid={!!errors.newEmail}>
				<FieldLabel htmlFor='new-email'>New email</FieldLabel>
				<Input
					{...register('newEmail')}
					aria-invalid={!!errors.newEmail}
					disabled={request.isPending}
					id='new-email'
					type='email'
				/>
				<FieldError errors={[errors.newEmail]} />
			</Field>

			<Field data-invalid={!!errors.currentPassword}>
				<FieldLabel htmlFor='curr-pass'>Current password (if set)</FieldLabel>
				<Input
					{...register('currentPassword')}
					aria-invalid={!!errors.currentPassword}
					disabled={request.isPending}
					id='curr-pass'
					type='password'
				/>
				<FieldError errors={[errors.currentPassword]} />
			</Field>

			<div className='flex justify-end gap-2'>
				<Button disabled={request.isPending} type='submit'>
					{request.isPending && <Spinner className='mr-2' />}
					Send confirmation link
				</Button>
			</div>
		</form>
	);
}

export default EmailChangeForm;

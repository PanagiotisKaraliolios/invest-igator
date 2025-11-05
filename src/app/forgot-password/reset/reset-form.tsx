'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { resetPassword } from '@/lib/auth-client';

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
	const [isLoading, setIsLoading] = useState(false);
	const router = useRouter();
	const {
		formState: { errors },
		handleSubmit,
		register
	} = useForm<FormValues>({
		defaultValues: { confirm: '', password: '' },
		resolver: zodResolver(schema)
	});

	async function onSubmit(values: FormValues) {
		setIsLoading(true);
		try {
			const result = await resetPassword({
				newPassword: values.password,
				token
			});

			if (result.error) {
				const msg = result.error.message || 'Reset link is invalid or expired';
				toast.error(msg);
				return;
			}

			toast.success('Password updated. You can now sign in.');
			router.push('/login');
		} catch (err) {
			const msg = (err as { message?: string })?.message || 'Reset link is invalid or expired';
			toast.error(msg);
		} finally {
			setIsLoading(false);
		}
	}

	return (
		<form className='space-y-4' data-testid='reset-form' onSubmit={handleSubmit(onSubmit)}>
			<Field data-invalid={!!errors.password}>
				<FieldLabel htmlFor='reset-password'>New password</FieldLabel>
				<InputGroup>
					<InputGroupInput
						aria-invalid={!!errors.password}
						autoComplete='new-password'
						data-testid='reset-password'
						id='reset-password'
						type={showNew ? 'text' : 'password'}
						{...register('password')}
					/>
					<InputGroupAddon align='inline-end'>
						<InputGroupButton
							aria-label={showNew ? 'Hide password' : 'Show password'}
							data-testid='reset-toggle-new'
							onClick={() => setShowNew((s) => !s)}
							size='icon-xs'
							variant='ghost'
						>
							{showNew ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
						</InputGroupButton>
					</InputGroupAddon>
				</InputGroup>
				<FieldError errors={[errors.password]} />
			</Field>
			<Field data-invalid={!!errors.confirm}>
				<FieldLabel htmlFor='reset-confirm'>Confirm password</FieldLabel>
				<InputGroup>
					<InputGroupInput
						aria-invalid={!!errors.confirm}
						autoComplete='new-password'
						data-testid='reset-confirm'
						id='reset-confirm'
						type={showConfirm ? 'text' : 'password'}
						{...register('confirm')}
					/>
					<InputGroupAddon align='inline-end'>
						<InputGroupButton
							aria-label={showConfirm ? 'Hide password' : 'Show password'}
							data-testid='reset-toggle-confirm'
							onClick={() => setShowConfirm((s) => !s)}
							size='icon-xs'
							variant='ghost'
						>
							{showConfirm ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
						</InputGroupButton>
					</InputGroupAddon>
				</InputGroup>
				<FieldError errors={[errors.confirm]} />
			</Field>

			<Button className='w-full' data-testid='reset-submit' disabled={isLoading} type='submit'>
				{isLoading ? 'Updating…' : 'Update password'}
			</Button>
		</form>
	);
}

export default ResetPasswordForm;

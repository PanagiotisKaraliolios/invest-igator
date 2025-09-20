'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api } from '@/trpc/react';

export default function PasswordCard() {
	const profile = api.account.getProfile.useQuery();

	const schema = useMemo(
		() =>
			z
				.object({
					confirmPassword: z.string(),
					currentPassword: z.string().optional(),
					newPassword: z
						.string()
						.min(8, 'Password must be at least 8 characters')
						.regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, 'Use letters and numbers')
				})
				.superRefine((vals, ctx) => {
					if (vals.newPassword !== vals.confirmPassword) {
						ctx.addIssue({
							code: z.ZodIssueCode.custom,
							message: 'Passwords do not match',
							path: ['confirmPassword']
						});
					}
					if (profile.data?.hasPassword && !vals.currentPassword) {
						ctx.addIssue({
							code: z.ZodIssueCode.custom,
							message: 'Current password is required',
							path: ['currentPassword']
						});
					}
				}),
		[profile.data?.hasPassword]
	);

	const form = useForm<z.infer<typeof schema>>({
		defaultValues: { confirmPassword: '', currentPassword: '', newPassword: '' },
		resolver: zodResolver(schema)
	});

	const [showCurrent, setShowCurrent] = useState(false);
	const [showNew, setShowNew] = useState(false);
	const [showConfirm, setShowConfirm] = useState(false);

	const change = api.account.changePassword.useMutation({
		onError: (e) => toast.error(e.message || 'Failed to change password'),
		onSuccess: () => {
			form.reset();
			toast.success('Password changed');
		}
	});

	const setPw = api.account.setPassword.useMutation({
		onError: (e) => toast.error(e.message || 'Failed to set password'),
		onSuccess: () => {
			form.reset();
			toast.success('Password set');
			// refetch profile to reflect hasPassword=true
			profile.refetch();
		}
	});

	// Prevent same new vs current password when changing
	const onSubmit = (values: z.infer<typeof schema>) => {
		if (profile.data?.hasPassword && values.currentPassword && values.currentPassword === values.newPassword) {
			form.setError('newPassword', {
				message: 'New password must be different from current password',
				type: 'manual'
			});
			return;
		}
		if (profile.data?.hasPassword) {
			change.mutate({ currentPassword: values.currentPassword || '', newPassword: values.newPassword });
		} else {
			setPw.mutate({ newPassword: values.newPassword });
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Password</CardTitle>
				<CardDescription>
					{profile.data?.hasPassword ? 'Update your account password.' : 'Set a password for your account.'}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Form key={profile.data?.hasPassword ? 'with-pass' : 'no-pass'} {...form}>
					<form className='space-y-3' data-testid='password-form' onSubmit={form.handleSubmit(onSubmit)}>
						{profile.data?.hasPassword ? (
							<FormField
								control={form.control}
								name='currentPassword'
								render={({ field }) => (
									<FormItem>
										<FormLabel>Current password</FormLabel>
										<FormControl>
											<div className='relative'>
												<Input
													data-testid='current-password-input'
													disabled={change.isPending}
													placeholder='••••••••'
													type={showCurrent ? 'text' : 'password'}
													{...field}
												/>
												<button
													aria-label={showCurrent ? 'Hide password' : 'Show password'}
													className='absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground'
													onClick={() => setShowCurrent((s) => !s)}
													type='button'
												>
													{showCurrent ? (
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
						) : null}
						<FormField
							control={form.control}
							name='newPassword'
							render={({ field }) => (
								<FormItem>
									<FormLabel>{profile.data?.hasPassword ? 'New password' : 'Password'}</FormLabel>
									<FormControl>
										<div className='relative'>
											<Input
												data-testid='new-password-input'
												disabled={change.isPending || setPw.isPending}
												placeholder='••••••••'
												type={showNew ? 'text' : 'password'}
												{...field}
											/>
											<button
												aria-label={showNew ? 'Hide password' : 'Show password'}
												className='absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground'
												onClick={() => setShowNew((s) => !s)}
												type='button'
											>
												{showNew ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
											</button>
										</div>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name='confirmPassword'
							render={({ field }) => (
								<FormItem>
									<FormLabel>
										Confirm {profile.data?.hasPassword ? 'new password' : 'password'}
									</FormLabel>
									<FormControl>
										<div className='relative'>
											<Input
												data-testid='confirm-password-input'
												disabled={change.isPending || setPw.isPending}
												placeholder='••••••••'
												type={showConfirm ? 'text' : 'password'}
												{...field}
											/>
											<button
												aria-label={showConfirm ? 'Hide password' : 'Show password'}
												className='absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground'
												onClick={() => setShowConfirm((s) => !s)}
												type='button'
											>
												{showConfirm ? (
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
							data-testid='password-submit-button'
							disabled={change.isPending || setPw.isPending}
							type='submit'
						>
							{profile.data?.hasPassword ? 'Change password' : 'Set password'}
						</Button>
					</form>
				</Form>
			</CardContent>
		</Card>
	);
}

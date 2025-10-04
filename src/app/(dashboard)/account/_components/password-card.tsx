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
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
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
							code: 'custom',
							message: 'Passwords do not match',
							path: ['confirmPassword']
						});
					}
					if (profile.data?.hasPassword && !vals.currentPassword) {
						ctx.addIssue({
							code: 'custom',
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
											<InputGroup>
												<InputGroupInput
													data-testid='current-password-input'
													disabled={change.isPending}
													placeholder='••••••••'
													type={showCurrent ? 'text' : 'password'}
													{...field}
												/>
												<InputGroupAddon align='inline-end'>
													<InputGroupButton
														aria-label={showCurrent ? 'Hide password' : 'Show password'}
														onClick={() => setShowCurrent((s) => !s)}
													>
														{showCurrent ? (
															<EyeOff className='h-4 w-4' />
														) : (
															<Eye className='h-4 w-4' />
														)}
													</InputGroupButton>
												</InputGroupAddon>
											</InputGroup>
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
										<InputGroup>
											<InputGroupInput
												data-testid='new-password-input'
												disabled={change.isPending || setPw.isPending}
												placeholder='••••••••'
												type={showNew ? 'text' : 'password'}
												{...field}
											/>
											<InputGroupAddon align='inline-end'>
												<InputGroupButton
													aria-label={showNew ? 'Hide password' : 'Show password'}
													onClick={() => setShowNew((s) => !s)}
												>
													{showNew ? (
														<EyeOff className='h-4 w-4' />
													) : (
														<Eye className='h-4 w-4' />
													)}
												</InputGroupButton>
											</InputGroupAddon>
										</InputGroup>
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
										<InputGroup>
											<InputGroupInput
												data-testid='confirm-password-input'
												disabled={change.isPending || setPw.isPending}
												placeholder='••••••••'
												type={showConfirm ? 'text' : 'password'}
												{...field}
											/>
											<InputGroupAddon align='inline-end'>
												<InputGroupButton
													aria-label={showConfirm ? 'Hide password' : 'Show password'}
													onClick={() => setShowConfirm((s) => !s)}
												>
													{showConfirm ? (
														<EyeOff className='h-4 w-4' />
													) : (
														<Eye className='h-4 w-4' />
													)}
												</InputGroupButton>
											</InputGroupAddon>
										</InputGroup>
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
							{(change.isPending || setPw.isPending) && <Spinner className='mr-2' />}
							{profile.data?.hasPassword ? 'Change password' : 'Set password'}
						</Button>
					</form>
				</Form>
			</CardContent>
		</Card>
	);
}

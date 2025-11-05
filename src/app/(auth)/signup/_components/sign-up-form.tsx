'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { signUp } from '@/lib/auth-client';

const schema = z
	.object({
		confirmPassword: z.string(),
		email: z.email(),
		name: z.string().min(2, 'Name must be at least 2 characters'),
		password: z
			.string()
			.min(8, 'Password must be at least 8 characters')
			.regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, 'Use letters and numbers')
	})
	.refine((vals) => vals.password === vals.confirmPassword, {
		message: 'Passwords do not match',
		path: ['confirmPassword']
	});

export function SignUpForm() {
	const router = useRouter();
	const {
		formState: { errors, isSubmitting },
		handleSubmit,
		register,
		setError: setFormError
	} = useForm<z.infer<typeof schema>>({
		defaultValues: { confirmPassword: '', email: '', name: '', password: '' },
		resolver: zodResolver(schema)
	});

	const [info, setInfo] = useState<string | null>(null);
	const [countdown, setCountdown] = useState<number | null>(null);
	const [showPassword, setShowPassword] = useState(false);
	const [showConfirmPassword, setShowConfirmPassword] = useState(false);

	async function onSubmit(values: z.infer<typeof schema>) {
		setInfo(null);
		try {
			const result = await signUp.email({
				email: values.email,
				name: values.name,
				password: values.password
			});

			if (result.error) {
				const message = result.error.message ?? 'Failed to create account';
				if (message.includes('already exists') || message.includes('email')) {
					setFormError('email', { message, type: 'manual' });
				} else {
					setFormError('name', { message, type: 'manual' });
				}
				return;
			}

			setInfo('Account created. Check your email to verify your account.');
			setCountdown(3);
		} catch (err) {
			const message = (err as { message?: string })?.message ?? 'Failed to create account';
			setFormError('email', { message, type: 'manual' });
		}
	}

	useEffect(() => {
		if (countdown === null) return;
		if (countdown <= 0) {
			router.push('/login');
			return;
		}
		const t = setTimeout(() => setCountdown((c) => (c ?? 0) - 1), 1000);
		return () => clearTimeout(t);
	}, [countdown, router]);

	return (
		<Card>
			<CardHeader className='text-center'>
				<CardTitle className='text-xl'>Create your account</CardTitle>
				<CardDescription>Sign up with your name and email</CardDescription>
			</CardHeader>
			<CardContent>
				<form className='space-y-4' onSubmit={handleSubmit(onSubmit)}>
					<Field data-invalid={!!errors.name}>
						<FieldLabel htmlFor='signup-name'>Name</FieldLabel>
						<Input
							aria-invalid={!!errors.name}
							id='signup-name'
							placeholder='Jane Doe'
							{...register('name')}
						/>
						<FieldError errors={[errors.name]} />
					</Field>
					<Field data-invalid={!!errors.email}>
						<FieldLabel htmlFor='signup-email'>Email</FieldLabel>
						<Input
							aria-invalid={!!errors.email}
							id='signup-email'
							placeholder='jane@example.com'
							type='email'
							{...register('email')}
						/>
						<FieldError errors={[errors.email]} />
					</Field>
					<Field data-invalid={!!errors.password}>
						<FieldLabel htmlFor='signup-password'>Password</FieldLabel>
						<InputGroup>
							<InputGroupInput
								aria-invalid={!!errors.password}
								id='signup-password'
								placeholder='••••••••'
								type={showPassword ? 'text' : 'password'}
								{...register('password')}
							/>
							<InputGroupAddon align='inline-end'>
								<InputGroupButton
									aria-label={showPassword ? 'Hide password' : 'Show password'}
									onClick={() => setShowPassword((s) => !s)}
									size='icon-xs'
									variant='ghost'
								>
									{showPassword ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
								</InputGroupButton>
							</InputGroupAddon>
						</InputGroup>
						<FieldError errors={[errors.password]} />
					</Field>
					<Field data-invalid={!!errors.confirmPassword}>
						<FieldLabel htmlFor='signup-confirm-password'>Confirm password</FieldLabel>
						<InputGroup>
							<InputGroupInput
								aria-invalid={!!errors.confirmPassword}
								id='signup-confirm-password'
								placeholder='••••••••'
								type={showConfirmPassword ? 'text' : 'password'}
								{...register('confirmPassword')}
							/>
							<InputGroupAddon align='inline-end'>
								<InputGroupButton
									aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
									onClick={() => setShowConfirmPassword((s) => !s)}
									size='icon-xs'
									variant='ghost'
								>
									{showConfirmPassword ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
								</InputGroupButton>
							</InputGroupAddon>
						</InputGroup>
						<FieldError errors={[errors.confirmPassword]} />
					</Field>
					{info ? (
						<div className='rounded bg-muted/50 p-3 text-sm'>
							{info}
							{countdown !== null ? (
								<div className='mt-1'>Redirecting to login in {countdown}s…</div>
							) : null}
						</div>
					) : null}
					<Button
						className='h-auto w-full whitespace-normal wrap-break-word leading-tight'
						disabled={isSubmitting}
						type='submit'
					>
						{isSubmitting ? 'Creating…' : 'Create account'}
					</Button>
					<div className='text-muted-foreground mt-2 text-center text-sm'>
						Already have an account?{' '}
						<Link className='underline underline-offset-4 hover:text-foreground' href='/login'>
							Log in
						</Link>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/trpc/react';

export default function PasswordCard() {
	const [current, setCurrent] = useState('');
	const [next, setNext] = useState('');
	const [confirm, setConfirm] = useState('');

	const change = api.account.changePassword.useMutation({
		onError: (e) => toast.error(e.message || 'Failed to change password'),
		onSuccess: () => {
			setCurrent('');
			setNext('');
			setConfirm('');
			toast.success('Password changed');
		}
	});

	const onSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (next.length < 8) {
			toast.error('New password must be at least 8 characters');
			return;
		}
		if (next !== confirm) {
			toast.error('Passwords do not match');
			return;
		}
		change.mutate({ currentPassword: current, newPassword: next });
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Password</CardTitle>
				<CardDescription>Update your account password.</CardDescription>
			</CardHeader>
			<CardContent>
				<form className='space-y-3' onSubmit={onSubmit}>
					<div className='space-y-2'>
						<Label htmlFor='current'>Current password</Label>
						<Input
							disabled={change.isPending}
							id='current'
							onChange={(e) => setCurrent(e.target.value)}
							type='password'
							value={current}
						/>
					</div>
					<div className='space-y-2'>
						<Label htmlFor='next'>New password</Label>
						<Input
							disabled={change.isPending}
							id='next'
							onChange={(e) => setNext(e.target.value)}
							type='password'
							value={next}
						/>
					</div>
					<div className='space-y-2'>
						<Label htmlFor='confirm'>Confirm new password</Label>
						<Input
							disabled={change.isPending}
							id='confirm'
							onChange={(e) => setConfirm(e.target.value)}
							type='password'
							value={confirm}
						/>
					</div>
					<Button disabled={change.isPending} type='submit'>
						Change password
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}

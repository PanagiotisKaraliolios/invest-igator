'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { api, type RouterOutputs } from '@/trpc/react';

export default function ProfileCard({ initial }: { initial: RouterOutputs['account']['getProfile'] }) {
	const router = useRouter();
	const utils = api.useUtils();
	const update = api.account.updateProfile.useMutation({
		onError: (e) => toast.error(e.message || 'Failed to update profile'),
		onSuccess: async () => {
			await utils.account.getProfile.invalidate();
			toast.success('Profile updated');
			// Ensure session-backed UI (e.g., header avatar) refreshes
			router.refresh();
		}
	});

	const [name, setName] = useState(initial?.name ?? '');
	const [image, setImage] = useState(initial?.image ?? '');
	const [emailDialogOpen, setEmailDialogOpen] = useState(false);
	useEffect(() => {
		setName(initial?.name ?? '');
		setImage(initial?.image ?? '');
	}, [initial?.name, initial?.image]);

	const dirty = useMemo(
		() => (name ?? '') !== (initial?.name ?? '') || (image ?? '') !== (initial?.image ?? ''),
		[name, image, initial?.name, initial?.image]
	);

	const onSave = () => {
		const trimmedName = (name ?? '').trim();
		const trimmedImage = (image ?? '').trim();
		if (!trimmedName) {
			toast.error('Name is required');
			return;
		}
		update.mutate({ image: trimmedImage, name: trimmedName });
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Profile</CardTitle>
			</CardHeader>
			<CardContent className='space-y-3'>
				<Label htmlFor='name'>Name</Label>
				<Input
					disabled={update.isPending}
					id='name'
					onChange={(e) => setName(e.target.value)}
					placeholder='Your name'
					value={name}
				/>
				<Label htmlFor='avatar'>Avatar URL</Label>
				<Input
					disabled={update.isPending}
					id='avatar'
					onChange={(e) => setImage(e.target.value)}
					placeholder='https://...'
					value={image}
				/>
				<div className='flex items-center justify-between'>
					<div className='flex items-center gap-2'>
						<p className='text-xs text-muted-foreground'>Email: {initial?.email}</p>
						{!initial?.emailVerified && initial?.email ? <RequestVerifyButton /> : null}
					</div>
					<Dialog onOpenChange={setEmailDialogOpen} open={emailDialogOpen}>
						<DialogTrigger asChild>
							<Button size='sm' variant='outline'>
								Change email
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Change email securely</DialogTitle>
								<DialogDescription>
									Enter a new email. If your account has a password, you must confirm it. We’ll send a
									confirmation link to the new email to complete the change.
								</DialogDescription>
							</DialogHeader>
							<EmailChangeForm onDone={() => setEmailDialogOpen(false)} />
							<DialogFooter />
						</DialogContent>
					</Dialog>
				</div>
			</CardContent>
			<CardFooter className='flex items-center gap-2'>
				<Button
					disabled={!dirty || update.isPending}
					onClick={() => {
						setName(initial?.name ?? '');
						setImage(initial?.image ?? '');
					}}
					variant='outline'
				>
					Cancel
				</Button>
				<Button disabled={!dirty || update.isPending} onClick={onSave}>
					{update.isPending && <Spinner className='mr-2' />}
					Save changes
				</Button>
			</CardFooter>
		</Card>
	);
}

function EmailChangeForm({ onDone }: { onDone?: () => void }) {
	const emailChangeSchema = z.object({
		currentPassword: z.string().optional(),
		newEmail: z.email('Enter a valid email')
	});
	type EmailChangeFormInput = z.infer<typeof emailChangeSchema>;

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

function RequestVerifyButton() {
	const request = api.account.requestEmailVerification.useMutation({
		onError: (e) => toast.error(e.message || 'Failed to send verification email'),
		onSuccess: () => toast.success('Verification email sent')
	});
	return (
		<Button disabled={request.isPending} onClick={() => request.mutate()} size='sm' variant='default'>
			{request.isPending && <Spinner className='mr-2' />}
			{request.isPending ? 'Sending…' : 'Verify email'}
		</Button>
	);
}

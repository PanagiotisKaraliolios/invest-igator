'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
					<p className='text-xs text-muted-foreground'>Email: {initial?.email}</p>
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
					Save changes
				</Button>
			</CardFooter>
		</Card>
	);
}

function EmailChangeForm({ onDone }: { onDone?: () => void }) {
	const [newEmail, setNewEmail] = useState('');
	const [currentPassword, setCurrentPassword] = useState('');
	const request = api.account.requestEmailChange.useMutation({
		onError: (e) => toast.error(e.message || 'Failed to start email change'),
		onSuccess: () => {
			setNewEmail('');
			setCurrentPassword('');
			toast.success('Check your new email for a confirmation link');
			onDone?.();
		}
	});
	const onSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		request.mutate({ currentPassword: currentPassword || undefined, newEmail });
	};
	return (
		<form className='space-y-3' onSubmit={onSubmit}>
			<div className='space-y-2'>
				<Label htmlFor='new-email'>New email</Label>
				<Input
					disabled={request.isPending}
					id='new-email'
					onChange={(e) => setNewEmail(e.target.value)}
					required
					type='email'
					value={newEmail}
				/>
			</div>
			<div className='space-y-2'>
				<Label htmlFor='curr-pass'>Current password (if set)</Label>
				<Input
					disabled={request.isPending}
					id='curr-pass'
					onChange={(e) => setCurrentPassword(e.target.value)}
					type='password'
					value={currentPassword}
				/>
			</div>
			<div className='flex justify-end gap-2'>
				<Button disabled={request.isPending} type='submit'>
					Send confirmation link
				</Button>
			</div>
		</form>
	);
}

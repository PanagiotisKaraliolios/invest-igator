'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api, type RouterOutputs } from '@/trpc/react';
import { EditProfilePictureDialog } from './edit-profile-picture-dialog';
import { EmailChangeDialog } from './email-change-dialog';
import { RequestVerifyButton } from './request-verify-button';

const profileSchema = z.object({
	name: z.string().trim().min(1, 'Name is required')
});

type ProfileFormInput = z.infer<typeof profileSchema>;

export default function ProfileCard({ initial }: { initial: RouterOutputs['account']['getProfile'] }) {
	const router = useRouter();
	const utils = api.useUtils();
	const [editPictureOpen, setEditPictureOpen] = useState(false);

	const update = api.account.updateProfile.useMutation({
		onError: (e) => toast.error(e.message || 'Failed to update profile'),
		onSuccess: async () => {
			await utils.account.getProfile.invalidate();
			toast.success('Profile updated');
			// Ensure session-backed UI (e.g., header avatar) refreshes
			router.refresh();
		}
	});

	const form = useForm<ProfileFormInput>({
		defaultValues: {
			name: initial?.name ?? ''
		},
		resolver: zodResolver(profileSchema)
	});

	// Keep form in sync if the server-provided initial values change
	useEffect(() => {
		form.reset({ name: initial?.name ?? '' });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [initial?.name]);

	const onSubmit = (values: ProfileFormInput) => {
		const trimmedName = (values.name ?? '').trim();
		update.mutate({ image: initial?.image ?? '', name: trimmedName });
	};

	const isDirty = form.formState.isDirty;

	// Get initials for avatar fallback
	const initials =
		initial?.name
			?.split(' ')
			.map((n) => n[0])
			.join('')
			.toUpperCase()
			.slice(0, 2) ?? '??';

	return (
		<>
			<Card>
				<CardHeader>
					<CardTitle>Profile</CardTitle>
				</CardHeader>
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)}>
						<CardContent className='space-y-3'>
							{/* Profile Picture Section */}
							<div className='space-y-2'>
								<FormLabel>Profile Picture</FormLabel>
								<div className='flex items-center gap-4'>
									<Avatar className='h-20 w-20'>
										<AvatarImage alt={initial?.name ?? 'User'} src={initial?.image ?? undefined} />
										<AvatarFallback>{initials}</AvatarFallback>
									</Avatar>
									<Button onClick={() => setEditPictureOpen(true)} type='button' variant='outline'>
										Edit
									</Button>
								</div>
							</div>

							<FormField
								control={form.control}
								name='name'
								render={({ field }) => (
									<FormItem>
										<FormLabel htmlFor='name'>Name</FormLabel>
										<FormControl>
											<Input
												disabled={update.isPending}
												id='name'
												placeholder='Your name'
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<div className='flex items-center justify-between'>
								<div className='flex items-center gap-2'>
									<p className='text-xs text-muted-foreground'>Email: {initial?.email}</p>
									{!initial?.emailVerified && initial?.email ? <RequestVerifyButton /> : null}
								</div>
								<EmailChangeDialog />
							</div>
						</CardContent>
						<CardFooter className='flex items-center gap-2'>
							<Button
								disabled={!isDirty || update.isPending}
								onClick={() => form.reset({ name: initial?.name ?? '' })}
								type='button'
								variant='outline'
							>
								Cancel
							</Button>
							<Button disabled={!isDirty || update.isPending} type='submit'>
								{update.isPending && <Spinner className='mr-2' />}
								Save changes
							</Button>
						</CardFooter>
					</form>
				</Form>
			</Card>

			<EditProfilePictureDialog
				currentImage={initial?.image}
				currentName={initial?.name}
				onOpenChange={setEditPictureOpen}
				open={editPictureOpen}
			/>
		</>
	);
}

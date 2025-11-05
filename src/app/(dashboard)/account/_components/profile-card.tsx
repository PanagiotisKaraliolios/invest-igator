'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/trpc/react';
import { EditProfilePictureDialog } from './edit-profile-picture-dialog';
import { EmailChangeDialog } from './email-change-dialog';
import { RequestVerifyButton } from './request-verify-button';

const profileSchema = z.object({
	name: z.string().trim().min(1, 'Name is required')
});

type ProfileFormInput = z.infer<typeof profileSchema>;

export default function ProfileCard() {
	const utils = api.useUtils();
	const [editPictureOpen, setEditPictureOpen] = useState(false);

	const {
		data: profileData,
		isLoading,
		error
	} = api.account.getMe.useQuery(undefined, {
		gcTime: 10 * 60 * 1000, // 10 minutes
		staleTime: 5 * 60 * 1000 // 5 minutes
	});

	const update = api.account.updateProfile.useMutation({
		onError: (e) => toast.error(e.message || 'Failed to update profile'),
		onSuccess: async () => {
			await utils.account.getMe.invalidate();
			toast.success('Profile updated');
		}
	});

	const {
		formState: { errors, isDirty },
		handleSubmit,
		register,
		reset
	} = useForm<ProfileFormInput>({
		defaultValues: {
			name: profileData?.name ?? ''
		},
		resolver: zodResolver(profileSchema)
	});

	// Keep form in sync if the server-provided profileData values change
	useEffect(() => {
		reset({ name: profileData?.name ?? '' });
	}, [profileData?.name]);

	const onSubmit = (values: ProfileFormInput) => {
		const trimmedName = (values.name ?? '').trim();
		update.mutate({ name: trimmedName });
	};

	// Get initials for avatar fallback
	const initials =
		profileData?.name
			?.split(' ')
			.map((n) => n[0])
			.join('')
			.toUpperCase()
			.slice(0, 2) ?? '??';

	if (isLoading) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Profile</CardTitle>
				</CardHeader>
				<CardContent className='space-y-4'>
					<div className='space-y-3'>
						<div className='space-y-2'>
							<Skeleton className='h-4 w-24' />
							<div className='flex items-center gap-4'>
								<Skeleton className='h-20 w-20 rounded-full' />
								<Skeleton className='h-10 w-20' />
							</div>
						</div>
						<div className='space-y-2'>
							<Skeleton className='h-4 w-16' />
							<Skeleton className='h-10 w-full' />
						</div>
						<Skeleton className='h-4 w-48' />
					</div>
				</CardContent>
			</Card>
		);
	}

	if (error || !profileData) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Profile</CardTitle>
				</CardHeader>
				<CardContent>
					<Alert variant='destructive'>
						<AlertCircle className='h-4 w-4' />
						<AlertTitle>Error loading profile</AlertTitle>
						<AlertDescription>
							Unable to load your profile information. Please refresh the page and try again.
						</AlertDescription>
					</Alert>
				</CardContent>
			</Card>
		);
	}

	return (
		<>
			<Card>
				<CardHeader>
					<CardTitle>Profile</CardTitle>
				</CardHeader>
				<form onSubmit={handleSubmit(onSubmit)}>
					<CardContent className='space-y-3'>
						{/* Profile Picture Section */}
						<div className='space-y-2'>
							<FieldLabel>Profile Picture</FieldLabel>
							<div className='flex items-center gap-4'>
								<Avatar className='h-20 w-20'>
									<AvatarImage
										alt={profileData?.name ?? 'User'}
										src={profileData?.avatar ?? undefined}
									/>
									<AvatarFallback>{initials}</AvatarFallback>
								</Avatar>
								<Button onClick={() => setEditPictureOpen(true)} type='button' variant='outline'>
									Edit
								</Button>
							</div>
						</div>

						<Field data-invalid={!!errors.name}>
							<FieldLabel htmlFor='name'>Name</FieldLabel>
							<Input
								{...register('name')}
								aria-invalid={!!errors.name}
								disabled={update.isPending}
								id='name'
								placeholder='Your name'
							/>
							<FieldError errors={[errors.name]} />
						</Field>

						<Field>
							<FieldLabel htmlFor='email'>Email</FieldLabel>
							<div className='flex items-center gap-2'>
								<Input disabled id='email' readOnly type='email' value={profileData?.email ?? ''} />
								<EmailChangeDialog />
								{!profileData?.emailVerified && profileData?.email ? (
									<RequestVerifyButton email={profileData.email} />
								) : null}
							</div>
						</Field>
					</CardContent>
					<CardFooter className='flex items-center gap-2 pt-6'>
						<Button
							disabled={!isDirty || update.isPending}
							onClick={() => reset({ name: profileData?.name ?? '' })}
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
			</Card>

			<EditProfilePictureDialog
				currentImage={profileData?.avatar}
				currentName={profileData?.name}
				onOpenChange={setEditPictureOpen}
				open={editPictureOpen}
			/>
		</>
	);
}

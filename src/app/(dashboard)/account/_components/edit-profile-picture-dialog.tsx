'use client';

import { useRouter } from 'next/navigation';
import React, { useState } from 'react';
import ReactCrop, { type Crop, centerCrop, makeAspectCrop, type PixelCrop } from 'react-image-crop';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@/components/ui/dialog';
import { FileUpload } from '@/components/ui/file-upload';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/trpc/react';

interface EditProfilePictureDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	currentImage?: string | null;
	currentName?: string | null;
}

export function EditProfilePictureDialog({
	open,
	onOpenChange,
	currentImage,
	currentName
}: EditProfilePictureDialogProps) {
	const utils = api.useUtils();

	const [activeTab, setActiveTab] = useState<'upload' | 'url'>('upload');
	const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [croppedImageUrl, setCroppedImageUrl] = useState<string | null>(null);
	const [showCropper, setShowCropper] = useState(false);
	const [urlInput, setUrlInput] = useState(currentImage ?? '');
	const [crop, setCrop] = useState<Crop>();
	const imgRef = React.useRef<HTMLImageElement | null>(null);

	const uploadMutation = api.account.uploadProfilePicture.useMutation({
		onError: (e) => {
			toast.dismiss('profile-picture-loading');
			toast.error(e.message || 'Failed to upload profile picture');
		},
		onSuccess: async () => {
			toast.dismiss('profile-picture-loading');
			toast.success('Profile picture updated');
			await utils.account.getMe.invalidate();
			handleClose();
		}
	});

	const updateProfileMutation = api.account.updateProfile.useMutation({
		onError: (e) => {
			toast.dismiss('profile-picture-loading');
			toast.error(e.message || 'Failed to update profile');
		},
		onSuccess: async () => {
			toast.dismiss('profile-picture-loading');
			toast.success('Profile picture updated');
			await utils.account.getMe.invalidate();
			handleClose();
		}
	});

	const handleClose = () => {
		setSelectedFiles([]);
		setPreviewUrl(null);
		setCroppedImageUrl(null);
		setShowCropper(false);
		setCrop(undefined);
		setUrlInput(currentImage ?? '');
		setActiveTab('upload');
		onOpenChange(false);
	};

	const handleFileChange = (files: File[]) => {
		const file = files[0];
		if (!file) {
			setSelectedFiles([]);
			setPreviewUrl(null);
			setCroppedImageUrl(null);
			setShowCropper(false);
			return;
		}

		setSelectedFiles(files);

		// Create preview URL and show cropper
		const reader = new FileReader();
		reader.onloadend = () => {
			const dataUrl = reader.result as string;
			setPreviewUrl(dataUrl);
			setShowCropper(true);
			setCroppedImageUrl(null); // Reset cropped image
		};
		reader.readAsDataURL(file);
	};

	const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
		const { width, height } = e.currentTarget;
		const newCrop = centerAspectCrop(width, height, 1);
		setCrop(newCrop);
	};

	const getCroppedImg = (image: HTMLImageElement, crop: PixelCrop): string => {
		const canvas = document.createElement('canvas');
		const scaleX = image.naturalWidth / image.width;
		const scaleY = image.naturalHeight / image.height;

		canvas.width = crop.width * scaleX;
		canvas.height = crop.height * scaleY;

		const ctx = canvas.getContext('2d');

		if (ctx) {
			ctx.imageSmoothingEnabled = true;
			ctx.imageSmoothingQuality = 'high';

			ctx.drawImage(
				image,
				crop.x * scaleX,
				crop.y * scaleY,
				crop.width * scaleX,
				crop.height * scaleY,
				0,
				0,
				crop.width * scaleX,
				crop.height * scaleY
			);
		}

		return canvas.toDataURL('image/jpeg', 0.95);
	};

	const handleApplyCrop = () => {
		if (imgRef.current && crop) {
			const pixelCrop: PixelCrop = {
				height: (crop.height / 100) * imgRef.current.height,
				unit: 'px',
				width: (crop.width / 100) * imgRef.current.width,
				x: (crop.x / 100) * imgRef.current.width,
				y: (crop.y / 100) * imgRef.current.height
			};
			const croppedDataUrl = getCroppedImg(imgRef.current, pixelCrop);
			setCroppedImageUrl(croppedDataUrl);
			setShowCropper(false);
		}
	};

	const handleCancelCrop = () => {
		setShowCropper(false);
		setPreviewUrl(null);
		setSelectedFiles([]);
		setCrop(undefined);
	};

	const handleUpload = () => {
		if (!croppedImageUrl) {
			toast.error('Please crop the image first');
			return;
		}

		toast.loading('Uploading profile picture...', { id: 'profile-picture-loading' });
		// Note: Compression happens server-side with Sharp for better quality and performance
		uploadMutation.mutate({ dataUrl: croppedImageUrl });
	};

	const handleUrlUpdate = () => {
		const trimmedUrl = urlInput.trim();

		// Validate URL format if not empty
		if (trimmedUrl && !trimmedUrl.startsWith('http')) {
			toast.error('Please enter a valid URL');
			return;
		}

		toast.loading('Saving profile picture...', { id: 'profile-picture-loading' });
		updateProfileMutation.mutate({
			image: trimmedUrl,
			name: currentName ?? ''
		});
	};

	const isPending = uploadMutation.isPending || updateProfileMutation.isPending;

	return (
		<Dialog onOpenChange={handleClose} open={open}>
			<DialogContent className='sm:max-w-[425px]'>
				<DialogHeader>
					<DialogTitle>Edit Profile Picture</DialogTitle>
					<DialogDescription>Upload a new image or provide a URL for your profile picture.</DialogDescription>
				</DialogHeader>

				<Tabs onValueChange={(v) => setActiveTab(v as 'upload' | 'url')} value={activeTab}>
					<TabsList className='grid w-full grid-cols-2'>
						<TabsTrigger value='upload'>Upload</TabsTrigger>
						<TabsTrigger value='url'>URL</TabsTrigger>
					</TabsList>

					<TabsContent className='space-y-4' value='upload'>
						{!showCropper ? (
							<>
								<div className='space-y-2'>
									<Label>Select Image</Label>
									<FileUpload
										accept='image/*'
										maxFiles={1}
										maxSize={5 * 1024 * 1024}
										onChange={handleFileChange}
										value={selectedFiles}
									/>
								</div>

								{croppedImageUrl && (
									<div className='flex flex-col items-center gap-2'>
										<p className='text-sm text-muted-foreground'>Preview:</p>
										<img
											alt='Preview'
											className='h-32 w-32 rounded-full object-cover border-2'
											src={croppedImageUrl}
										/>
										<Button
											onClick={() => {
												setShowCropper(true);
												setCroppedImageUrl(null);
											}}
											size='sm'
											type='button'
											variant='outline'
										>
											Re-crop Image
										</Button>
									</div>
								)}

								<DialogFooter>
									<Button disabled={isPending} onClick={handleClose} type='button' variant='outline'>
										Cancel
									</Button>
									<Button
										disabled={!croppedImageUrl || isPending}
										onClick={handleUpload}
										type='button'
									>
										Upload
									</Button>
								</DialogFooter>
							</>
						) : (
							<>
								<div className='space-y-4'>
									<p className='text-sm text-muted-foreground text-center'>
										Adjust the crop area to select the part of the image you want to use
									</p>
									<div className='flex flex-col items-center gap-4'>
										<ReactCrop
											aspect={1}
											className='max-w-full max-h-[50vh]'
											crop={crop}
											onChange={(_, percentCrop) => setCrop(percentCrop)}
										>
											<img
												alt='Crop preview'
												onLoad={onImageLoad}
												ref={imgRef}
												src={previewUrl || ''}
											/>
										</ReactCrop>
									</div>
								</div>

								<DialogFooter>
									<Button onClick={handleCancelCrop} size='sm' type='button' variant='outline'>
										Cancel
									</Button>
									<Button disabled={!crop} onClick={handleApplyCrop} size='sm' type='button'>
										Apply Crop
									</Button>
								</DialogFooter>
							</>
						)}
					</TabsContent>

					<TabsContent className='space-y-4' value='url'>
						<div className='space-y-2'>
							<Label htmlFor='url'>Image URL</Label>
							<Input
								disabled={isPending}
								id='url'
								onChange={(e) => setUrlInput(e.target.value)}
								placeholder='https://example.com/image.jpg'
								type='url'
								value={urlInput}
							/>
						</div>

						{urlInput && (
							<div className='flex justify-center'>
								<img
									alt='Preview'
									className='h-32 w-32 rounded-full object-cover'
									onError={(e) => {
										(e.target as HTMLImageElement).style.display = 'none';
									}}
									src={urlInput}
								/>
							</div>
						)}

						<DialogFooter>
							<Button disabled={isPending} onClick={handleClose} type='button' variant='outline'>
								Cancel
							</Button>
							<Button disabled={isPending} onClick={handleUrlUpdate} type='button'>
								Save
							</Button>
						</DialogFooter>
					</TabsContent>
				</Tabs>
			</DialogContent>
		</Dialog>
	);
}

// Helper function to center the crop
function centerAspectCrop(mediaWidth: number, mediaHeight: number, aspect: number): Crop {
	return centerCrop(
		makeAspectCrop(
			{
				height: 50,
				unit: '%',
				width: 50
			},
			aspect,
			mediaWidth,
			mediaHeight
		),
		mediaWidth,
		mediaHeight
	);
}

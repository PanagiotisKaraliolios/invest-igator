'use client';

import { CropIcon, XIcon } from 'lucide-react';
import React, { type SyntheticEvent } from 'react';
import ReactCrop, { type Crop, centerCrop, makeAspectCrop, type PixelCrop } from 'react-image-crop';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface ImageCropperProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	imageUrl: string;
	onCropComplete: (croppedDataUrl: string) => void;
}

export function ImageCropper({ open, onOpenChange, imageUrl, onCropComplete }: ImageCropperProps) {
	const aspect = 1; // 1:1 ratio for profile pictures

	const imgRef = React.useRef<HTMLImageElement | null>(null);

	const [crop, setCrop] = React.useState<Crop>();
	const [croppedImageUrl, setCroppedImageUrl] = React.useState<string>('');

	function onImageLoad(e: SyntheticEvent<HTMLImageElement>) {
		const { width, height } = e.currentTarget;
		const newCrop = centerAspectCrop(width, height, aspect);
		setCrop(newCrop);

		// Generate initial crop preview
		if (imgRef.current) {
			const pixelCrop: PixelCrop = {
				height: (newCrop.height / 100) * height,
				unit: 'px',
				width: (newCrop.width / 100) * width,
				x: (newCrop.x / 100) * width,
				y: (newCrop.y / 100) * height
			};
			const croppedUrl = getCroppedImg(imgRef.current, pixelCrop);
			setCroppedImageUrl(croppedUrl);
		}
	}

	function onCropChange(_: PixelCrop, percentCrop: Crop) {
		setCrop(percentCrop);
	}

	function onCropCompleteHandler(crop: PixelCrop) {
		if (imgRef.current && crop.width && crop.height) {
			const croppedUrl = getCroppedImg(imgRef.current, crop);
			setCroppedImageUrl(croppedUrl);
		}
	}

	function getCroppedImg(image: HTMLImageElement, crop: PixelCrop): string {
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
	}

	function handleCrop() {
		if (croppedImageUrl) {
			onCropComplete(croppedImageUrl);
			onOpenChange(false);
		}
	}

	function handleCancel() {
		onOpenChange(false);
	}

	return (
		<Dialog modal={true} onOpenChange={onOpenChange} open={open}>
			<DialogContent className='p-0 gap-0 max-w-2xl' onInteractOutside={(e) => e.preventDefault()}>
				<DialogHeader className='p-6 pb-0'>
					<DialogTitle>Crop Profile Picture</DialogTitle>
				</DialogHeader>
				<div className='p-6 pt-4'>
					<div className='flex flex-col items-center gap-4'>
						<ReactCrop
							aspect={aspect}
							className='max-h-[60vh]'
							crop={crop}
							onChange={onCropChange}
							onComplete={onCropCompleteHandler}
						>
							<img
								alt='Crop preview'
								className='max-w-full'
								onLoad={onImageLoad}
								ref={imgRef}
								src={imageUrl}
								style={{ maxHeight: '60vh' }}
							/>
						</ReactCrop>

						{croppedImageUrl && (
							<div className='flex flex-col items-center gap-2'>
								<p className='text-sm text-muted-foreground'>Preview:</p>
								<img
									alt='Cropped preview'
									className='h-32 w-32 rounded-full object-cover border-2'
									src={croppedImageUrl}
								/>
							</div>
						)}
					</div>
				</div>
				<DialogFooter className='p-6 pt-0 flex-row justify-end gap-2'>
					<Button onClick={handleCancel} size='sm' type='button' variant='outline'>
						<XIcon className='mr-1.5 size-4' />
						Cancel
					</Button>
					<Button disabled={!croppedImageUrl} onClick={handleCrop} size='sm' type='button'>
						<CropIcon className='mr-1.5 size-4' />
						Apply Crop
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// Helper function to center the crop
export function centerAspectCrop(mediaWidth: number, mediaHeight: number, aspect: number): Crop {
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

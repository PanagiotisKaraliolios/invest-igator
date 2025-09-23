'use client';

import { Upload, X } from 'lucide-react';
import type { DragEvent, KeyboardEvent } from 'react';
import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type FileUploadProps = {
	accept?: string;
	maxFiles?: number;
	maxSize?: number;
	onChange?: (files: File[]) => void;
	value?: File[];
};

function formatBytes(size: number): string {
	const units = ['B', 'KB', 'MB', 'GB'];
	let s = size;
	let u = 0;
	while (s >= 1024 && u < units.length - 1) {
		s /= 1024;
		u++;
	}
	return `${s.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
}

export function FileUpload({ accept, maxFiles = 1, maxSize, onChange, value = [] }: FileUploadProps) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [isDragging, setIsDragging] = useState(false);

	const setFiles = useCallback(
		(next: FileList | File[]) => {
			const list = Array.from(next);
			const limited = list.slice(0, maxFiles);
			const filtered = typeof maxSize === 'number' ? limited.filter((file) => file.size <= maxSize) : limited;
			onChange?.(filtered);
		},
		[maxFiles, maxSize, onChange]
	);

	const handleDrop = useCallback(
		(event: DragEvent<HTMLDivElement>) => {
			event.preventDefault();
			event.stopPropagation();
			setIsDragging(false);
			if (event.dataTransfer?.files?.length) {
				setFiles(event.dataTransfer.files);
			}
		},
		[setFiles]
	);

	const handleBrowse = useCallback(() => {
		inputRef.current?.click();
	}, []);

	const hintText = maxFiles > 1 ? `Upload up to ${maxFiles} files` : 'Upload a file';

	return (
		<div className='space-y-3'>
			<div
				className={cn(
					'flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-muted-foreground/60 bg-muted/40 p-6 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
					isDragging ? 'border-primary bg-primary/10' : 'hover:border-primary/80'
				)}
				onClick={handleBrowse}
				onDragLeave={() => setIsDragging(false)}
				onDragOver={(event) => {
					event.preventDefault();
					event.stopPropagation();
					setIsDragging(true);
				}}
				onDrop={handleDrop}
				onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						handleBrowse();
					}
				}}
				role='button'
				tabIndex={0}
			>
				<input
					accept={accept}
					className='hidden'
					multiple={maxFiles > 1}
					onChange={(event) => {
						const files = event.target.files;
						if (files) setFiles(files);
					}}
					ref={inputRef}
					type='file'
				/>
				<Upload className='mb-2 h-8 w-8 text-muted-foreground' />
				<p className='text-sm font-medium'>Drag & drop or click to browse</p>
				<p className='text-xs text-muted-foreground'>{hintText}</p>
				{typeof maxSize === 'number' ? (
					<p className='text-xs text-muted-foreground'>Max size {formatBytes(maxSize)}</p>
				) : null}
			</div>

			{value.length > 0 ? (
				<ul className='space-y-2 text-sm'>
					{value.map((file, index) => (
						<li
							className='flex items-center justify-between rounded-md border px-3 py-2'
							key={`${file.name}-${index}`}
						>
							<div className='flex flex-col overflow-hidden text-left'>
								<span className='truncate font-medium'>{file.name}</span>
								<span className='text-xs text-muted-foreground'>{formatBytes(file.size)}</span>
							</div>
							<Button
								aria-label={`Remove ${file.name}`}
								onClick={(event) => {
									event.stopPropagation();
									onChange?.(value.filter((_, i) => i !== index));
								}}
								size='icon'
								variant='ghost'
							>
								<X className='h-4 w-4' />
							</Button>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

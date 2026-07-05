'use client';

import { Progress as ProgressPrimitive } from '@base-ui/react/progress';
import type * as React from 'react';

import { cn } from '@/lib/utils';

function Progress({ className, value, ...props }: React.ComponentProps<typeof ProgressPrimitive.Root>) {
	return (
		<ProgressPrimitive.Root
			className={cn('bg-primary/20 relative h-2 w-full overflow-hidden rounded-full', className)}
			data-slot='progress'
			value={value}
			{...props}
		>
			<ProgressPrimitive.Track className='size-full' data-slot='progress-track'>
				<ProgressPrimitive.Indicator
					className='bg-primary h-full w-full flex-1 transition-all'
					data-slot='progress-indicator'
				/>
			</ProgressPrimitive.Track>
		</ProgressPrimitive.Root>
	);
}

export { Progress };

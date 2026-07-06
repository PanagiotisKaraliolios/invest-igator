'use client';

import { Slider as SliderPrimitive } from '@base-ui/react/slider';
import * as React from 'react';

import { cn } from '@/lib/utils';

function Slider({
	className,
	defaultValue,
	value,
	min = 0,
	max = 100,
	...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
	const _values = React.useMemo(
		() => (Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max]),
		[value, defaultValue, min, max]
	);

	return (
		<SliderPrimitive.Root
			className={cn(
				'relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
				className
			)}
			data-slot='slider'
			defaultValue={defaultValue}
			max={max}
			min={min}
			thumbAlignment='edge'
			value={value}
			{...props}
		>
			<SliderPrimitive.Control
				className='relative flex grow items-center data-[orientation=vertical]:h-full data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col'
				data-slot='slider-control'
			>
				<SliderPrimitive.Track
					className={cn(
						'bg-muted relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5'
					)}
					data-slot='slider-track'
				>
					<SliderPrimitive.Indicator
						className={cn(
							'bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full'
						)}
						data-slot='slider-range'
					/>
					{Array.from({ length: _values.length }, (_, index) => (
						<SliderPrimitive.Thumb
							className='border-primary ring-ring/50 block size-4 shrink-0 rounded-full border bg-white shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden data-disabled:pointer-events-none data-disabled:opacity-50'
							data-slot='slider-thumb'
							index={index}
							key={index}
						/>
					))}
				</SliderPrimitive.Track>
			</SliderPrimitive.Control>
		</SliderPrimitive.Root>
	);
}

export { Slider };

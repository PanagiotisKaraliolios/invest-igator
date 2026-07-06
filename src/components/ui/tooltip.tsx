'use client';

import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import * as React from 'react';

import { cn } from '@/lib/utils';

function TooltipProvider({ delay = 0, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
	return <TooltipPrimitive.Provider delay={delay} {...props} />;
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
	return (
		<TooltipProvider>
			<TooltipPrimitive.Root {...props} />
		</TooltipProvider>
	);
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
	return <TooltipPrimitive.Trigger data-slot='tooltip-trigger' {...props} />;
}

function TooltipContent({
	className,
	sideOffset = 4,
	side,
	align,
	alignOffset,
	children,
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Popup> &
	Pick<React.ComponentProps<typeof TooltipPrimitive.Positioner>, 'side' | 'sideOffset' | 'align' | 'alignOffset'>) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Positioner
				align={align}
				alignOffset={alignOffset}
				className='isolate z-50'
				side={side}
				sideOffset={sideOffset}
			>
				<TooltipPrimitive.Popup
					className={cn(
						'bg-foreground text-background z-50 w-fit origin-(--transform-origin) rounded-md px-3 py-1.5 text-xs text-balance data-starting-style:animate-in data-starting-style:fade-in-0 data-starting-style:zoom-in-95 data-ending-style:animate-out data-ending-style:fade-out-0 data-ending-style:zoom-out-95 data-[side=bottom]:data-starting-style:slide-in-from-top-2 data-[side=left]:data-starting-style:slide-in-from-right-2 data-[side=right]:data-starting-style:slide-in-from-left-2 data-[side=top]:data-starting-style:slide-in-from-bottom-2',
						className
					)}
					data-slot='tooltip-content'
					{...props}
				>
					{children}
					<TooltipPrimitive.Arrow
						className={cn(
							'bg-foreground fill-foreground z-50 size-2.5 rotate-45 rounded-[2px]',
							'data-[side=bottom]:top-1 data-[side=left]:right-[-13px] data-[side=left]:top-1/2! data-[side=left]:-translate-y-1/2 data-[side=right]:left-[-13px] data-[side=right]:top-1/2! data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5'
						)}
					/>
				</TooltipPrimitive.Popup>
			</TooltipPrimitive.Positioner>
		</TooltipPrimitive.Portal>
	);
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };

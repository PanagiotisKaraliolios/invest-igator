import { NavigationMenu as NavigationMenuPrimitive } from '@base-ui/react/navigation-menu';
import { cva } from 'class-variance-authority';
import { ChevronDownIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

function NavigationMenu({ className, children, ...props }: React.ComponentProps<typeof NavigationMenuPrimitive.Root>) {
	// Base UI drops Radix's `viewport` boolean: the shared popup is always rendered
	// as Portal > Positioner > Popup > Viewport (see NavigationMenuViewport), and
	// each Item's Content is teleported into it when active.
	return (
		<NavigationMenuPrimitive.Root
			className={cn(
				'group/navigation-menu relative flex max-w-max flex-1 items-center justify-center',
				className
			)}
			data-slot='navigation-menu'
			{...props}
		>
			{children}
			<NavigationMenuViewport />
		</NavigationMenuPrimitive.Root>
	);
}

function NavigationMenuList({ className, ...props }: React.ComponentProps<typeof NavigationMenuPrimitive.List>) {
	return (
		<NavigationMenuPrimitive.List
			className={cn('group flex flex-1 list-none items-center justify-center gap-1', className)}
			data-slot='navigation-menu-list'
			{...props}
		/>
	);
}

function NavigationMenuItem({ className, ...props }: React.ComponentProps<typeof NavigationMenuPrimitive.Item>) {
	return (
		<NavigationMenuPrimitive.Item
			className={cn('relative', className)}
			data-slot='navigation-menu-item'
			{...props}
		/>
	);
}

const navigationMenuTriggerStyle = cva(
	'group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-[popup-open]:hover:bg-accent data-[popup-open]:text-accent-foreground data-[popup-open]:focus:bg-accent data-[popup-open]:bg-accent/50 focus-visible:ring-ring/50 outline-none transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:outline-1'
);

function NavigationMenuTrigger({
	className,
	children,
	...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Trigger>) {
	return (
		<NavigationMenuPrimitive.Trigger
			className={cn(navigationMenuTriggerStyle(), 'group', className)}
			data-slot='navigation-menu-trigger'
			{...props}
		>
			{children}{' '}
			<ChevronDownIcon
				aria-hidden='true'
				className='relative top-[1px] ml-1 size-3 transition duration-300 group-data-[popup-open]:rotate-180'
			/>
		</NavigationMenuPrimitive.Trigger>
	);
}

function NavigationMenuContent({ className, ...props }: React.ComponentProps<typeof NavigationMenuPrimitive.Content>) {
	// Base UI drives entry/exit via data-starting-style / data-ending-style, and the
	// spatial slide via data-activation-direction (left/right) instead of Radix's
	// data-motion (from-/to-start/end). The old group-data-[viewport=false] inline
	// mode is gone (no `viewport` prop) — that class block was removed.
	return (
		<NavigationMenuPrimitive.Content
			className={cn(
				'data-starting-style:animate-in data-ending-style:animate-out data-starting-style:fade-in data-ending-style:fade-out data-[activation-direction=right]:data-starting-style:slide-in-from-right-52 data-[activation-direction=left]:data-starting-style:slide-in-from-left-52 data-[activation-direction=right]:data-ending-style:slide-out-to-right-52 data-[activation-direction=left]:data-ending-style:slide-out-to-left-52 top-0 left-0 w-full p-2 pr-2.5 md:absolute md:w-auto',
				className
			)}
			data-slot='navigation-menu-content'
			{...props}
		/>
	);
}

function NavigationMenuViewport({
	className,
	...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Viewport>) {
	// Radix rendered a single Viewport below the List. Base UI uses real anchored
	// positioning: Portal > Positioner > Popup > Viewport. The Popup is the visible
	// box (bg/border/shadow/size/animation live here; --popup-width/height are set
	// on it); the Viewport is the inner clip that holds the active Content.
	return (
		<NavigationMenuPrimitive.Portal>
			<NavigationMenuPrimitive.Positioner className='isolate z-50'>
				<NavigationMenuPrimitive.Popup
					className={cn(
						'origin-top-center bg-popover text-popover-foreground data-starting-style:animate-in data-ending-style:animate-out data-ending-style:zoom-out-95 data-starting-style:zoom-in-90 relative mt-1.5 h-[var(--popup-height)] w-full overflow-hidden rounded-md border shadow md:w-[var(--popup-width)]',
						className
					)}
					data-slot='navigation-menu-viewport'
				>
					<NavigationMenuPrimitive.Viewport {...props} />
				</NavigationMenuPrimitive.Popup>
			</NavigationMenuPrimitive.Positioner>
		</NavigationMenuPrimitive.Portal>
	);
}

function NavigationMenuLink({ className, ...props }: React.ComponentProps<typeof NavigationMenuPrimitive.Link>) {
	return (
		<NavigationMenuPrimitive.Link
			className={cn(
				"data-[active]:focus:bg-accent data-[active]:hover:bg-accent data-[active]:bg-accent/50 data-[active]:text-accent-foreground hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus-visible:ring-ring/50 [&_svg:not([class*='text-'])]:text-muted-foreground flex flex-col gap-1 rounded-sm p-2 text-sm transition-all outline-none focus-visible:ring-[3px] focus-visible:outline-1 [&_svg:not([class*='size-'])]:size-4",
				className
			)}
			data-slot='navigation-menu-link'
			{...props}
		/>
	);
}

function NavigationMenuIndicator({ className, ...props }: React.ComponentProps<typeof NavigationMenuPrimitive.Arrow>) {
	// Radix's Indicator tracked the active trigger below the List; Base UI has no
	// list-tracking part. Arrow (a popup-anchored pointer) is the closest analogue,
	// but it must be rendered inside a Popup and exposes data-open/closed +
	// data-starting-style/ending-style rather than Radix's data-[state=visible].
	return (
		<NavigationMenuPrimitive.Arrow
			className={cn(
				'data-starting-style:animate-in data-ending-style:animate-out data-ending-style:fade-out data-starting-style:fade-in top-full z-[1] flex h-1.5 items-end justify-center overflow-hidden',
				className
			)}
			data-slot='navigation-menu-indicator'
			{...props}
		>
			<div className='bg-border relative top-[60%] h-2 w-2 rotate-45 rounded-tl-sm shadow-md' />
		</NavigationMenuPrimitive.Arrow>
	);
}

export {
	NavigationMenu,
	NavigationMenuContent,
	NavigationMenuIndicator,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
	NavigationMenuTrigger,
	NavigationMenuViewport,
	navigationMenuTriggerStyle
};

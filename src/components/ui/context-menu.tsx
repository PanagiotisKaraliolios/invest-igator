'use client';

import { ContextMenu as ContextMenuPrimitive } from '@base-ui/react/context-menu';
import { CheckIcon, ChevronRightIcon, CircleIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

function ContextMenu({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
	// ContextMenu.Root renders no DOM element (its props omit BaseUIComponentProps),
	// so it can't take data-slot — mirrors dropdown-menu's Menu.Root wrapper.
	return <ContextMenuPrimitive.Root {...props} />;
}

function ContextMenuTrigger({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
	return <ContextMenuPrimitive.Trigger data-slot='context-menu-trigger' {...props} />;
}

function ContextMenuGroup({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Group>) {
	return <ContextMenuPrimitive.Group data-slot='context-menu-group' {...props} />;
}

function ContextMenuPortal({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Portal>) {
	return <ContextMenuPrimitive.Portal data-slot='context-menu-portal' {...props} />;
}

function ContextMenuSub({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.SubmenuRoot>) {
	return <ContextMenuPrimitive.SubmenuRoot {...props} />;
}

function ContextMenuRadioGroup({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.RadioGroup>) {
	return <ContextMenuPrimitive.RadioGroup data-slot='context-menu-radio-group' {...props} />;
}

function ContextMenuSubTrigger({
	className,
	inset,
	children,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubmenuTrigger> & {
	inset?: boolean;
}) {
	return (
		<ContextMenuPrimitive.SubmenuTrigger
			className={cn(
				"focus:bg-accent focus:text-accent-foreground data-[popup-open]:bg-accent data-[popup-open]:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className
			)}
			data-inset={inset}
			data-slot='context-menu-sub-trigger'
			{...props}
		>
			{children}
			<ChevronRightIcon className='ml-auto' />
		</ContextMenuPrimitive.SubmenuTrigger>
	);
}

function ContextMenuSubContent({
	className,
	align = 'start',
	alignOffset = -3,
	side = 'right',
	sideOffset = 0,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Popup> &
	Pick<
		React.ComponentProps<typeof ContextMenuPrimitive.Positioner>,
		'side' | 'sideOffset' | 'align' | 'alignOffset'
	>) {
	return (
		<ContextMenuPrimitive.Portal>
			<ContextMenuPrimitive.Positioner
				align={align}
				alignOffset={alignOffset}
				className='isolate z-50'
				side={side}
				sideOffset={sideOffset}
			>
				<ContextMenuPrimitive.Popup
					className={cn(
						'bg-popover text-popover-foreground data-starting-style:animate-in data-ending-style:animate-out data-ending-style:fade-out-0 data-starting-style:fade-in-0 data-ending-style:zoom-out-95 data-starting-style:zoom-in-95 data-[side=bottom]:data-starting-style:slide-in-from-top-2 data-[side=left]:data-starting-style:slide-in-from-right-2 data-[side=right]:data-starting-style:slide-in-from-left-2 data-[side=top]:data-starting-style:slide-in-from-bottom-2 z-50 min-w-[8rem] origin-(--transform-origin) overflow-hidden rounded-md border p-1 shadow-lg',
						className
					)}
					data-slot='context-menu-sub-content'
					{...props}
				/>
			</ContextMenuPrimitive.Positioner>
		</ContextMenuPrimitive.Portal>
	);
}

function ContextMenuContent({
	className,
	side,
	sideOffset,
	align,
	alignOffset,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Popup> &
	Pick<
		React.ComponentProps<typeof ContextMenuPrimitive.Positioner>,
		'side' | 'sideOffset' | 'align' | 'alignOffset'
	>) {
	return (
		<ContextMenuPrimitive.Portal>
			<ContextMenuPrimitive.Positioner
				align={align}
				alignOffset={alignOffset}
				className='isolate z-50'
				side={side}
				sideOffset={sideOffset}
			>
				<ContextMenuPrimitive.Popup
					className={cn(
						'bg-popover text-popover-foreground data-starting-style:animate-in data-ending-style:animate-out data-ending-style:fade-out-0 data-starting-style:fade-in-0 data-ending-style:zoom-out-95 data-starting-style:zoom-in-95 data-[side=bottom]:data-starting-style:slide-in-from-top-2 data-[side=left]:data-starting-style:slide-in-from-right-2 data-[side=right]:data-starting-style:slide-in-from-left-2 data-[side=top]:data-starting-style:slide-in-from-bottom-2 z-50 max-h-(--available-height) min-w-[8rem] origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md',
						className
					)}
					data-slot='context-menu-content'
					{...props}
				/>
			</ContextMenuPrimitive.Positioner>
		</ContextMenuPrimitive.Portal>
	);
}

function ContextMenuItem({
	className,
	inset,
	variant = 'default',
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
	inset?: boolean;
	variant?: 'default' | 'destructive';
}) {
	return (
		<ContextMenuPrimitive.Item
			className={cn(
				"focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className
			)}
			data-inset={inset}
			data-slot='context-menu-item'
			data-variant={variant}
			{...props}
		/>
	);
}

function ContextMenuCheckboxItem({
	className,
	children,
	checked,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>) {
	return (
		<ContextMenuPrimitive.CheckboxItem
			checked={checked}
			className={cn(
				"focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className
			)}
			data-slot='context-menu-checkbox-item'
			{...props}
		>
			<span className='pointer-events-none absolute left-2 flex size-3.5 items-center justify-center'>
				<ContextMenuPrimitive.CheckboxItemIndicator>
					<CheckIcon className='size-4' />
				</ContextMenuPrimitive.CheckboxItemIndicator>
			</span>
			{children}
		</ContextMenuPrimitive.CheckboxItem>
	);
}

function ContextMenuRadioItem({
	className,
	children,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioItem>) {
	return (
		<ContextMenuPrimitive.RadioItem
			className={cn(
				"focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className
			)}
			data-slot='context-menu-radio-item'
			{...props}
		>
			<span className='pointer-events-none absolute left-2 flex size-3.5 items-center justify-center'>
				<ContextMenuPrimitive.RadioItemIndicator>
					<CircleIcon className='size-2 fill-current' />
				</ContextMenuPrimitive.RadioItemIndicator>
			</span>
			{children}
		</ContextMenuPrimitive.RadioItem>
	);
}

function ContextMenuLabel({
	className,
	inset,
	...props
}: React.ComponentProps<'div'> & {
	inset?: boolean;
}) {
	// Radix's Label floated freely; Base UI's Menu.GroupLabel throws outside a
	// Menu.Group. shadcn uses this as a standalone header, so render a plain div.
	return (
		<div
			className={cn('text-foreground px-2 py-1.5 text-sm font-medium data-[inset]:pl-8', className)}
			data-inset={inset}
			data-slot='context-menu-label'
			{...props}
		/>
	);
}

function ContextMenuSeparator({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
	return (
		<ContextMenuPrimitive.Separator
			className={cn('bg-border -mx-1 my-1 h-px', className)}
			data-slot='context-menu-separator'
			{...props}
		/>
	);
}

function ContextMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
	return (
		<span
			className={cn('text-muted-foreground ml-auto text-xs tracking-widest', className)}
			data-slot='context-menu-shortcut'
			{...props}
		/>
	);
}

export {
	ContextMenu,
	ContextMenuCheckboxItem,
	ContextMenuContent,
	ContextMenuGroup,
	ContextMenuItem,
	ContextMenuLabel,
	ContextMenuPortal,
	ContextMenuRadioGroup,
	ContextMenuRadioItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger
};

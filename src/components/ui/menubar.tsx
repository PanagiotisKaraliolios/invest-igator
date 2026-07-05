'use client';

import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { Menubar as MenubarPrimitive } from '@base-ui/react/menubar';
import { CheckIcon, ChevronRightIcon, CircleIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

function Menubar({ className, ...props }: React.ComponentProps<typeof MenubarPrimitive>) {
	return (
		<MenubarPrimitive
			className={cn('bg-background flex h-9 items-center gap-1 rounded-md border p-1 shadow-xs', className)}
			data-slot='menubar'
			{...props}
		/>
	);
}

function MenubarMenu({ ...props }: React.ComponentProps<typeof MenuPrimitive.Root>) {
	// Radix Menubar.Menu → Menu.Root (renders no DOM element, so no data-slot).
	return <MenuPrimitive.Root {...props} />;
}

function MenubarGroup({ ...props }: React.ComponentProps<typeof MenuPrimitive.Group>) {
	return <MenuPrimitive.Group data-slot='menubar-group' {...props} />;
}

function MenubarPortal({ ...props }: React.ComponentProps<typeof MenuPrimitive.Portal>) {
	return <MenuPrimitive.Portal data-slot='menubar-portal' {...props} />;
}

function MenubarRadioGroup({ ...props }: React.ComponentProps<typeof MenuPrimitive.RadioGroup>) {
	return <MenuPrimitive.RadioGroup data-slot='menubar-radio-group' {...props} />;
}

function MenubarTrigger({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.Trigger>) {
	return (
		<MenuPrimitive.Trigger
			className={cn(
				'focus:bg-accent focus:text-accent-foreground data-[popup-open]:bg-accent data-[popup-open]:text-accent-foreground flex items-center rounded-sm px-2 py-1 text-sm font-medium outline-hidden select-none',
				className
			)}
			data-slot='menubar-trigger'
			{...props}
		/>
	);
}

function MenubarContent({
	className,
	align = 'start',
	alignOffset = -4,
	side,
	sideOffset = 8,
	...props
}: React.ComponentProps<typeof MenuPrimitive.Popup> &
	Pick<React.ComponentProps<typeof MenuPrimitive.Positioner>, 'side' | 'sideOffset' | 'align' | 'alignOffset'>) {
	return (
		<MenuPrimitive.Portal>
			<MenuPrimitive.Positioner
				align={align}
				alignOffset={alignOffset}
				className='isolate z-50'
				side={side}
				sideOffset={sideOffset}
			>
				<MenuPrimitive.Popup
					className={cn(
						'bg-popover text-popover-foreground data-starting-style:animate-in data-ending-style:fade-out-0 data-starting-style:fade-in-0 data-ending-style:zoom-out-95 data-starting-style:zoom-in-95 data-[side=bottom]:data-starting-style:slide-in-from-top-2 data-[side=left]:data-starting-style:slide-in-from-right-2 data-[side=right]:data-starting-style:slide-in-from-left-2 data-[side=top]:data-starting-style:slide-in-from-bottom-2 z-50 min-w-[12rem] origin-(--transform-origin) overflow-hidden rounded-md border p-1 shadow-md',
						className
					)}
					data-slot='menubar-content'
					{...props}
				/>
			</MenuPrimitive.Positioner>
		</MenuPrimitive.Portal>
	);
}

function MenubarItem({
	className,
	inset,
	variant = 'default',
	...props
}: React.ComponentProps<typeof MenuPrimitive.Item> & {
	inset?: boolean;
	variant?: 'default' | 'destructive';
}) {
	return (
		<MenuPrimitive.Item
			className={cn(
				"focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className
			)}
			data-inset={inset}
			data-slot='menubar-item'
			data-variant={variant}
			{...props}
		/>
	);
}

function MenubarCheckboxItem({
	className,
	children,
	checked,
	...props
}: React.ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
	return (
		<MenuPrimitive.CheckboxItem
			checked={checked}
			className={cn(
				"focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-xs py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className
			)}
			data-slot='menubar-checkbox-item'
			{...props}
		>
			<span className='pointer-events-none absolute left-2 flex size-3.5 items-center justify-center'>
				<MenuPrimitive.CheckboxItemIndicator>
					<CheckIcon className='size-4' />
				</MenuPrimitive.CheckboxItemIndicator>
			</span>
			{children}
		</MenuPrimitive.CheckboxItem>
	);
}

function MenubarRadioItem({ className, children, ...props }: React.ComponentProps<typeof MenuPrimitive.RadioItem>) {
	return (
		<MenuPrimitive.RadioItem
			className={cn(
				"focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-xs py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className
			)}
			data-slot='menubar-radio-item'
			{...props}
		>
			<span className='pointer-events-none absolute left-2 flex size-3.5 items-center justify-center'>
				<MenuPrimitive.RadioItemIndicator>
					<CircleIcon className='size-2 fill-current' />
				</MenuPrimitive.RadioItemIndicator>
			</span>
			{children}
		</MenuPrimitive.RadioItem>
	);
}

function MenubarLabel({
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
			className={cn('px-2 py-1.5 text-sm font-medium data-[inset]:pl-8', className)}
			data-inset={inset}
			data-slot='menubar-label'
			{...props}
		/>
	);
}

function MenubarSeparator({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.Separator>) {
	return (
		<MenuPrimitive.Separator
			className={cn('bg-border -mx-1 my-1 h-px', className)}
			data-slot='menubar-separator'
			{...props}
		/>
	);
}

function MenubarShortcut({ className, ...props }: React.ComponentProps<'span'>) {
	return (
		<span
			className={cn('text-muted-foreground ml-auto text-xs tracking-widest', className)}
			data-slot='menubar-shortcut'
			{...props}
		/>
	);
}

function MenubarSub({ ...props }: React.ComponentProps<typeof MenuPrimitive.SubmenuRoot>) {
	return <MenuPrimitive.SubmenuRoot {...props} />;
}

function MenubarSubTrigger({
	className,
	inset,
	children,
	...props
}: React.ComponentProps<typeof MenuPrimitive.SubmenuTrigger> & {
	inset?: boolean;
}) {
	return (
		<MenuPrimitive.SubmenuTrigger
			className={cn(
				'focus:bg-accent focus:text-accent-foreground data-[popup-open]:bg-accent data-[popup-open]:text-accent-foreground flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[inset]:pl-8',
				className
			)}
			data-inset={inset}
			data-slot='menubar-sub-trigger'
			{...props}
		>
			{children}
			<ChevronRightIcon className='ml-auto h-4 w-4' />
		</MenuPrimitive.SubmenuTrigger>
	);
}

function MenubarSubContent({
	className,
	align = 'start',
	alignOffset = -3,
	side = 'right',
	sideOffset = 0,
	...props
}: React.ComponentProps<typeof MenuPrimitive.Popup> &
	Pick<React.ComponentProps<typeof MenuPrimitive.Positioner>, 'side' | 'sideOffset' | 'align' | 'alignOffset'>) {
	return (
		<MenuPrimitive.Portal>
			<MenuPrimitive.Positioner
				align={align}
				alignOffset={alignOffset}
				className='isolate z-50'
				side={side}
				sideOffset={sideOffset}
			>
				<MenuPrimitive.Popup
					className={cn(
						'bg-popover text-popover-foreground data-starting-style:animate-in data-ending-style:animate-out data-ending-style:fade-out-0 data-starting-style:fade-in-0 data-ending-style:zoom-out-95 data-starting-style:zoom-in-95 data-[side=bottom]:data-starting-style:slide-in-from-top-2 data-[side=left]:data-starting-style:slide-in-from-right-2 data-[side=right]:data-starting-style:slide-in-from-left-2 data-[side=top]:data-starting-style:slide-in-from-bottom-2 z-50 min-w-[8rem] origin-(--transform-origin) overflow-hidden rounded-md border p-1 shadow-lg',
						className
					)}
					data-slot='menubar-sub-content'
					{...props}
				/>
			</MenuPrimitive.Positioner>
		</MenuPrimitive.Portal>
	);
}

export {
	Menubar,
	MenubarCheckboxItem,
	MenubarContent,
	MenubarGroup,
	MenubarItem,
	MenubarLabel,
	MenubarMenu,
	MenubarPortal,
	MenubarRadioGroup,
	MenubarRadioItem,
	MenubarSeparator,
	MenubarShortcut,
	MenubarSub,
	MenubarSubContent,
	MenubarSubTrigger,
	MenubarTrigger
};

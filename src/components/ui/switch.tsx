'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { Switch as SwitchPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn } from '@/lib/utils';

// Define a context for `permanent` state
const SwitchContext = React.createContext<{ permanent: boolean }>({
	permanent: false
});

const useSwitchContext = () => {
	const context = React.useContext(SwitchContext);
	if (!context) {
		throw new Error('SwitchIndicator must be used within a Switch component');
	}
	return context;
};

// Define classes for variants
const switchVariants = cva(
	`
    relative peer inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors 
    focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background 
    disabled:cursor-not-allowed disabled:opacity-50 data-[state=unchecked]:bg-input
    aria-invalid:border aria-invalid:border-destructive/60 aria-invalid:ring-destructive/10 dark:aria-invalid:border-destructive dark:aria-invalid:ring-destructive/20
    [[data-invalid=true]_&]:border [[data-invalid=true]_&]:border-destructive/60 [[data-invalid=true]_&]:ring-destructive/10  dark:[[data-invalid=true]_&]:border-destructive dark:[[data-invalid=true]_&]:ring-destructive/20
  `,
	{
		defaultVariants: {
			permanent: false,
			shape: 'pill',
			size: 'md'
		},
		variants: {
			permanent: {
				false: 'data-[state=checked]:bg-primary',
				true: 'bg-input'
			},
			shape: {
				pill: 'rounded-full',
				square: 'rounded-md'
			},
			size: {
				lg: 'h-8 w-14',
				md: 'h-6 w-10',
				sm: 'h-5 w-8',
				xl: 'h-9 w-16'
			}
		}
	}
);

const switchThumbVariants = cva(
	'rtl:data-[state=unchecked]:-translate-x-[2px] rtl:data-[state=checked]:-translate-x-[calc(100%-2px)] pointer-events-none start-0 block h-[calc(100%-4px)] w-1/2 bg-white shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-[2px]',
	{
		compoundVariants: [
			{
				className: 'rounded-sm',
				shape: 'square',
				size: 'xs'
			}
		],
		defaultVariants: {
			shape: 'pill',
			size: 'md'
		},
		variants: {
			shape: {
				pill: 'rounded-full',
				square: 'rounded-md'
			},
			size: {
				lg: '',
				md: '',
				sm: '',
				xl: '',
				xs: ''
			}
		}
	}
);

const switchIndicatorVariants = cva(
	'-translate-y-1/2 pointer-events-none absolute top-1/2 mx-[2px] flex w-1/2 items-center justify-center text-center font-medium text-sm transition-transform duration-300 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)]',
	{
		compoundVariants: [
			{
				className:
					'rtl:peer-data-[state=unchecked]:-translate-x-full text-primary-foreground peer-data-[state=unchecked]:invisible peer-data-[state=unchecked]:translate-x-full',
				permanent: false,
				state: 'on'
			},
			{
				className:
					'-translate-x-full peer-data-[state=checked]:invisible peer-data-[state=unchecked]:translate-x-0 rtl:translate-x-full',
				permanent: false,
				state: 'off'
			},
			{
				className: 'start-0',
				permanent: true,
				state: 'on'
			},
			{
				className: 'end-0',
				permanent: true,
				state: 'off'
			}
		],
		defaultVariants: {
			permanent: false,
			state: 'off'
		},
		variants: {
			permanent: {
				false: '',
				true: ''
			},
			state: {
				off: 'end-0',
				on: 'start-0'
			}
		}
	}
);

function SwitchWrapper({
	className,
	children,
	permanent = false,
	...props
}: React.HTMLAttributes<HTMLDivElement> & { permanent?: boolean }) {
	return (
		<SwitchContext.Provider value={{ permanent }}>
			<div className={cn('relative inline-flex items-center', className)} data-slot='switch-wrapper' {...props}>
				{children}
			</div>
		</SwitchContext.Provider>
	);
}

function Switch({
	className,
	thumbClassName = '',
	shape,
	size,
	...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> &
	VariantProps<typeof switchVariants> & { thumbClassName?: string }) {
	const context = useSwitchContext();
	const permanent = context?.permanent ?? false;

	return (
		<SwitchPrimitive.Root
			className={cn(switchVariants({ permanent, shape, size }), className)}
			data-slot='switch'
			{...props}
		>
			<SwitchPrimitive.Thumb className={cn(switchThumbVariants({ shape, size }), thumbClassName)} />
		</SwitchPrimitive.Root>
	);
}

function SwitchIndicator({
	className,
	state,
	...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof switchIndicatorVariants>) {
	const context = useSwitchContext();
	const permanent = context?.permanent ?? false;

	return (
		<span
			className={cn(switchIndicatorVariants({ permanent, state }), className)}
			data-slot='switch-indicator'
			{...props}
		/>
	);
}

export { Switch, SwitchIndicator, SwitchWrapper };

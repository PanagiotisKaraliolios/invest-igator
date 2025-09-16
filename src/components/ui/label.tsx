'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { Label as LabelPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn } from '@/lib/utils';

const labelVariants = cva(
	'text-sm leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
	{
		defaultVariants: {
			variant: 'primary'
		},
		variants: {
			variant: {
				primary: 'font-medium',
				secondary: 'font-normal'
			}
		}
	}
);

function Label({
	className,
	variant,
	...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>) {
	return <LabelPrimitive.Root className={cn(labelVariants({ variant }), className)} data-slot='label' {...props} />;
}

export { Label };

'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import { motion } from 'framer-motion';
import * as React from 'react';

import { cn } from '@/lib/utils';

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
	return <TabsPrimitive.Root className={cn('flex flex-col gap-2', className)} data-slot='tabs' {...props} />;
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
	return (
		<TabsPrimitive.List
			className={cn(
				'bg-muted text-muted-foreground relative inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]',
				className
			)}
			data-slot='tabs-list'
			{...props}
		/>
	);
}

function TabsTrigger({ className, children, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
	const [isActive, setIsActive] = React.useState(false);
	const ref = React.useRef<HTMLButtonElement>(null);

	React.useEffect(() => {
		const element = ref.current;
		if (!element) return;

		const observer = new MutationObserver(() => {
			setIsActive(element.getAttribute('data-state') === 'active');
		});

		observer.observe(element, {
			attributeFilter: ['data-state'],
			attributes: true
		});

		// Initial check
		setIsActive(element.getAttribute('data-state') === 'active');

		return () => observer.disconnect();
	}, []);

	return (
		<TabsPrimitive.Trigger
			className={cn(
				"focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring text-foreground dark:text-muted-foreground relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[state=active]:text-foreground",
				className
			)}
			data-slot='tabs-trigger'
			ref={ref}
			{...props}
		>
			{isActive && (
				<motion.div
					className='bg-background dark:bg-input/30 dark:border-input absolute inset-0 z-0 rounded-md border shadow-sm'
					layoutId='activeTab'
					transition={{
						damping: 30,
						stiffness: 500,
						type: 'spring'
					}}
				/>
			)}
			<span className='relative z-10'>{children}</span>
		</TabsPrimitive.Trigger>
	);
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
	return (
		<TabsPrimitive.Content className={cn('flex-1 outline-none', className)} data-slot='tabs-content' {...props} />
	);
}

export { Tabs, TabsList, TabsTrigger, TabsContent };

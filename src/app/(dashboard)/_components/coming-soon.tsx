import { Construction } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function ComingSoon({ feature, description }: { feature: string; description?: string }) {
	return (
		<div className='flex min-h-[60vh] items-center justify-center p-6'>
			<Card className='w-full max-w-md'>
				<CardContent className='flex flex-col items-center gap-4 py-2 text-center'>
					<div className='bg-muted flex size-12 items-center justify-center rounded-full'>
						<Construction className='text-muted-foreground size-6' />
					</div>
					<Badge variant='secondary'>Coming soon</Badge>
					<div className='space-y-1'>
						<h1 className='text-xl font-semibold'>{feature}</h1>
						<p className='text-muted-foreground text-sm'>
							{description ?? `${feature} isn't available yet — it's on the roadmap and coming soon.`}
						</p>
					</div>
					<Link className={cn(buttonVariants({ variant: 'outline' }))} href='/portfolio'>
						Back to Portfolio
					</Link>
				</CardContent>
			</Card>
		</div>
	);
}

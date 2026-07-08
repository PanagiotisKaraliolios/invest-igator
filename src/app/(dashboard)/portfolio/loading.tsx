import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
	return (
		<div className='space-y-6'>
			<Skeleton className='h-8 w-40' />
			<div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
				<Skeleton className='h-40 w-full' />
				<Skeleton className='h-40 w-full' />
			</div>
		</div>
	);
}

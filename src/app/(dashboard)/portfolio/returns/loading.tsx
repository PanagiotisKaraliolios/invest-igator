import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
	return (
		<div className='space-y-6'>
			<Skeleton className='h-8 w-56' />
			<Skeleton className='h-9 w-72' />
			<Skeleton className='h-[360px] w-full' />
		</div>
	);
}

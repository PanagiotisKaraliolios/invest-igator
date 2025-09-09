'use client';

import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type RouterOutputs } from '@/trpc/react';

type WatchlistItem = RouterOutputs['watchlist']['list'][number];

export default function MyWatchlist() {
	const utils = api.useUtils();
	const { data: items, isLoading } = api.watchlist.list.useQuery();
	const remove = api.watchlist.remove.useMutation({
		onSuccess: () => utils.watchlist.list.invalidate()
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>My Watchlist</CardTitle>
			</CardHeader>
			<CardContent className='space-y-2'>
				{isLoading && (
					<div className='space-y-2'>
						<Skeleton className='h-10 w-full' />
						<Skeleton className='h-10 w-full' />
						<Skeleton className='h-10 w-full' />
					</div>
				)}
				{!isLoading && items?.length ? (
					items.map((it: WatchlistItem) => (
						<div className='flex items-center justify-between rounded-md border p-2' key={it.id}>
							<div>
								<div className='font-medium'>{it.displaySymbol ?? it.symbol}</div>
								{it.description && (
									<div className='text-xs text-muted-foreground'>{it.description}</div>
								)}
							</div>
							<Button
								aria-label='Remove from watchlist'
								className='text-muted-foreground hover:text-destructive'
								onClick={() => remove.mutate({ symbol: it.symbol })}
								size='icon'
								variant='ghost'
							>
								<Trash2 className='h-4 w-4' />
							</Button>
						</div>
					))
				) : !isLoading ? (
					<div className='text-sm text-muted-foreground'>No items yet</div>
				) : null}
			</CardContent>
		</Card>
	);
}

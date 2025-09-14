'use client';

import { Star, StarOff, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type RouterOutputs } from '@/trpc/react';

type WatchlistItem = RouterOutputs['watchlist']['list'][number];

export default function MyWatchlist() {
	const utils = api.useUtils();
	const { data: items, isLoading } = api.watchlist.list.useQuery();
	const toggle = api.watchlist.toggleStar.useMutation({
		onError: (err) => toast.error(err.message || 'Failed to update'),
		onSuccess: async () => {
			await Promise.all([utils.watchlist.list.invalidate(), utils.watchlist.history.invalidate()]);
		}
	});
	const remove = api.watchlist.remove.useMutation({
		onError: (err) => {
			toast.error(err.message || 'Failed to remove');
		},
		onSuccess: () => {
			utils.watchlist.list.invalidate();
			toast.success('Removed from watchlist');
		}
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
							<div className='flex items-center gap-1'>
								<Button
									aria-label={it.starred ? 'Unstar' : 'Star'}
									className={it.starred ? 'text-yellow-500' : 'text-muted-foreground'}
									onClick={() => toggle.mutate({ starred: !it.starred, symbol: it.symbol })}
									size='icon'
									variant='ghost'
								>
									{it.starred ? (
										<Star className='h-4 w-4 fill-yellow-500' />
									) : (
										<StarOff className='h-4 w-4' />
									)}
								</Button>
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
						</div>
					))
				) : !isLoading ? (
					<div className='text-sm text-muted-foreground'>No items yet</div>
				) : null}
			</CardContent>
		</Card>
	);
}

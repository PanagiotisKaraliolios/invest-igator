'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/use-debounce';
import { api, type RouterOutputs } from '@/trpc/react';

type SearchResult = NonNullable<RouterOutputs['watchlist']['search']['result']>[number];

export default function SearchAssets() {
	const [q, setQ] = useState('');
	const debounced = useDebounce(q, 700);
	const utils = api.useUtils();
	const search = api.watchlist.search.useQuery({ q: debounced }, { enabled: debounced.trim().length > 1 });
	const add = api.watchlist.add.useMutation({
		onError: (err) => {
			toast.error(err.message || 'Failed to add');
		},
		onSuccess: (res) => {
			utils.watchlist.list.invalidate();
			if ((res as any)?.alreadyExists) {
				toast.info('Already watching this symbol');
			} else {
				toast.success('Added to watchlist');
			}
		}
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>Search assets</CardTitle>
			</CardHeader>
			<CardContent className='space-y-3'>
				<Input onChange={(e) => setQ(e.target.value)} placeholder='Search symbol or name...' value={q} />
				{debounced.trim().length > 1 && (
					<div className='space-y-2'>
						{search.isLoading && (
							<div className='space-y-2'>
								<Skeleton className='h-10 w-full' />
								<Skeleton className='h-10 w-full' />
								<Skeleton className='h-10 w-full' />
							</div>
						)}
						{search.data?.result?.slice(0, 10).map((r: SearchResult, idx) => (
							<div
								className='flex items-center justify-between rounded-md border p-2'
								key={`${r.symbol}-${idx}`}
							>
								<div>
									<div className='font-medium'>{r.displaySymbol || r.symbol}</div>
									<div className='text-xs text-muted-foreground'>{r.description}</div>
								</div>
								<Button
									aria-label='Add to watchlist'
									className='text-muted-foreground hover:text-primary'
									disabled={add.isPending}
									onClick={() =>
										add.mutate({
											description: r.description,
											displaySymbol: r.displaySymbol,
											symbol: r.symbol,
											type: r.type
										})
									}
									size='icon'
									variant='ghost'
								>
									<Plus className='h-4 w-4' />
								</Button>
							</div>
						))}
						{search.data && search.data.result.length === 0 && (
							<div className='text-sm text-muted-foreground'>No results</div>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import MyWatchlist from './_components/my-watchlist';
import SearchAssets from './_components/search-assets';
import WatchlistCharts from './_components/watchlist-charts';

export default function WatchlistPage() {
	return (
		<div className='space-y-6'>
			<h1 className='text-2xl font-semibold tracking-tight'>Watchlist</h1>
			<div>
				<Dialog>
					<DialogTrigger asChild>
						<Button size='sm'>
							<Plus className='mr-2 h-4 w-4' />
							Add to watchlist
						</Button>
					</DialogTrigger>
					<DialogContent className='max-w-2xl'>
						<DialogHeader>
							<DialogTitle>Search assets</DialogTitle>
						</DialogHeader>
						<SearchAssets />
					</DialogContent>
				</Dialog>
			</div>
			<WatchlistCharts />
			<MyWatchlist />
		</div>
	);
}

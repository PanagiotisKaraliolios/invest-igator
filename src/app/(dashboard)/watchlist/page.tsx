import MyWatchlist from './_components/my-watchlist';
import SearchAssets from './_components/search-assets';

export default function WatchlistPage() {
	return (
		<div className='space-y-6'>
			<h1 className='text-2xl font-semibold tracking-tight'>Watchlist</h1>
			<SearchAssets />
			<MyWatchlist />
		</div>
	);
}

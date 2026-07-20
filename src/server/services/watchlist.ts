import type { WatchlistItem } from '@prisma/generated';
import { db } from '@/server/db';

export type WatchlistRow = {
	symbol: string;
	displaySymbol: string | null;
	description: string | null;
	currency: string;
	starred: boolean;
};

export type WatchlistRecord = Pick<WatchlistItem, 'currency' | 'description' | 'displaySymbol' | 'starred' | 'symbol'>;

export function toWatchlistRow(i: WatchlistRecord): WatchlistRow {
	return {
		currency: i.currency,
		description: i.description ?? null,
		displaySymbol: i.displaySymbol ?? null,
		starred: i.starred,
		symbol: i.symbol
	};
}

/** Full Prisma records, in the router's historical order. The tRPC router returns these verbatim. */
export async function listWatchlistItems(userId: string): Promise<WatchlistItem[]> {
	return db.watchlistItem.findMany({
		orderBy: [{ starred: 'desc' }, { createdAt: 'desc' }],
		where: { userId }
	});
}

/** The AI-tool projection: no ids, no userId, no timestamps. */
export async function listWatchlist(userId: string): Promise<WatchlistRow[]> {
	const items = await listWatchlistItems(userId);
	return items.map(toWatchlistRow);
}

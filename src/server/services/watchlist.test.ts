import { beforeEach, describe, expect, mock, test } from 'bun:test';

type FindManyArgs = { orderBy?: unknown; where?: Record<string, unknown> };
const findManyCalls: FindManyArgs[] = [];

const ITEMS = [
	{
		createdAt: new Date('2024-01-01T00:00:00.000Z'),
		currency: 'USD',
		description: 'Apple Inc.',
		displaySymbol: 'AAPL',
		id: 'w1',
		starred: true,
		symbol: 'AAPL',
		type: null,
		userId: 'user-a'
	}
];

mock.module('@/server/db', () => ({
	db: {
		watchlistItem: {
			findMany: async (args: FindManyArgs) => {
				findManyCalls.push(args);
				return ITEMS;
			}
		}
	}
}));

const { listWatchlist, listWatchlistItems, toWatchlistRow } = await import('./watchlist');

beforeEach(() => {
	findManyCalls.length = 0;
});

describe('toWatchlistRow', () => {
	test('projects a Prisma item onto the wire shape and drops userId/id/createdAt', () => {
		const row = toWatchlistRow({
			currency: 'USD',
			description: 'Apple Inc.',
			displaySymbol: 'AAPL',
			starred: true,
			symbol: 'AAPL'
		});
		expect(row).toEqual({
			currency: 'USD',
			description: 'Apple Inc.',
			displaySymbol: 'AAPL',
			starred: true,
			symbol: 'AAPL'
		});
		expect(Object.keys(row)).not.toContain('userId');
	});

	test('null display fields survive as null, not undefined', () => {
		const row = toWatchlistRow({
			currency: 'EUR',
			description: null,
			displaySymbol: null,
			starred: false,
			symbol: 'SAP.DE'
		});
		expect(row.description).toBeNull();
		expect(row.displaySymbol).toBeNull();
	});
});

describe('listWatchlist — THE TENANT KEY REACHES THE QUERY', () => {
	test('scopes to the caller, keeps the router ordering, and projects away ids', async () => {
		const rows = await listWatchlist('user-a');
		expect(findManyCalls).toEqual([
			{ orderBy: [{ starred: 'desc' }, { createdAt: 'desc' }], where: { userId: 'user-a' } }
		]);
		expect(rows).toEqual([
			{ currency: 'USD', description: 'Apple Inc.', displaySymbol: 'AAPL', starred: true, symbol: 'AAPL' }
		]);
		// The router variant returns the raw records, same query.
		const records = await listWatchlistItems('user-a');
		expect(records[0]?.id).toBe('w1');
		expect(findManyCalls[1]?.where).toEqual({ userId: 'user-a' });
	});
});

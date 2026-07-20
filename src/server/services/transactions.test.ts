import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { TransactionFilters } from './transactions';

/**
 * Hermetic: `db` is a recording double, so this suite opens no connection AND can
 * assert the one thing that matters — the userId the service hands to Prisma.
 */

type FindManyArgs = { orderBy?: unknown; take?: number; where?: Record<string, unknown> };

const findManyCalls: FindManyArgs[] = [];

const RECORDS = [
	{
		date: new Date('2024-03-04T00:00:00.000Z'),
		fee: null,
		feeCurrency: null,
		id: 'tx1',
		note: 'first buy',
		price: 150.5,
		priceCurrency: 'USD',
		quantity: 10,
		side: 'BUY' as const,
		symbol: 'AAPL'
	}
];

mock.module('@/server/db', () => ({
	db: {
		transaction: {
			findMany: async (args: FindManyArgs) => {
				findManyCalls.push(args);
				return RECORDS;
			}
		}
	}
}));

const {
	buildTransactionWhere,
	clampTransactionLimit,
	DEFAULT_TRANSACTION_LIMIT,
	listTransactions,
	MAX_TRANSACTION_LIMIT,
	toTransactionRow
} = await import('./transactions');

beforeEach(() => {
	findManyCalls.length = 0;
});

describe('buildTransactionWhere', () => {
	test('always scopes to the userId, even with no filters', () => {
		expect(buildTransactionWhere('user-a', {})).toEqual({ userId: 'user-a' });
	});

	test('symbol is a case-insensitive contains, and blank is ignored', () => {
		expect(buildTransactionWhere('user-a', { symbol: '  aapl ' })).toEqual({
			symbol: { contains: 'aapl', mode: 'insensitive' },
			userId: 'user-a'
		});
		expect(buildTransactionWhere('user-a', { symbol: '   ' })).toEqual({ userId: 'user-a' });
	});

	test('dateTo is inclusive — it extends to the end of the day', () => {
		const where = buildTransactionWhere('user-a', { dateFrom: '2024-01-01', dateTo: '2024-01-31' });
		const date = where.date as { gte: Date; lte: Date };
		expect(date.gte).toEqual(new Date('2024-01-01'));
		const expectedLte = new Date('2024-01-31');
		expectedLte.setHours(23, 59, 59, 999);
		expect(date.lte).toEqual(expectedLte);
	});

	test('side is passed through verbatim', () => {
		expect(buildTransactionWhere('user-a', { side: 'SELL' })).toEqual({ side: 'SELL', userId: 'user-a' });
	});
});

describe('clampTransactionLimit', () => {
	test('defaults, floors, and caps', () => {
		expect(clampTransactionLimit(undefined)).toBe(DEFAULT_TRANSACTION_LIMIT);
		expect(clampTransactionLimit(Number.NaN)).toBe(DEFAULT_TRANSACTION_LIMIT);
		expect(clampTransactionLimit(0)).toBe(1);
		expect(clampTransactionLimit(10.9)).toBe(10);
		expect(clampTransactionLimit(10_000)).toBe(MAX_TRANSACTION_LIMIT);
	});
});

describe('toTransactionRow', () => {
	test('maps a Prisma record to the wire shape, dropping userId', () => {
		const row = toTransactionRow({
			date: new Date('2024-03-04T00:00:00.000Z'),
			fee: null,
			feeCurrency: null,
			id: 'tx1',
			note: 'first buy',
			price: 150.5,
			priceCurrency: 'USD',
			quantity: 10,
			side: 'BUY',
			symbol: 'AAPL'
		});
		expect(row).toEqual({
			date: '2024-03-04T00:00:00.000Z',
			fee: null,
			feeCurrency: null,
			id: 'tx1',
			note: 'first buy',
			price: 150.5,
			priceCurrency: 'USD',
			quantity: 10,
			side: 'BUY',
			symbol: 'AAPL'
		});
		expect(Object.keys(row)).not.toContain('userId');
	});
});

describe('listTransactions — THE TENANT KEY REACHES THE QUERY', () => {
	test('scopes the query to the caller, caps take, and orders deterministically', async () => {
		const rows = await listTransactions('user-a', { limit: 10_000 });
		expect(findManyCalls).toEqual([
			{
				orderBy: [{ date: 'desc' }, { id: 'desc' }],
				take: MAX_TRANSACTION_LIMIT,
				where: { userId: 'user-a' }
			}
		]);
		expect(rows[0]?.id).toBe('tx1');
	});

	test('a userId smuggled INTO THE FILTERS OBJECT cannot override the tenant key', async () => {
		await listTransactions('user-a', {
			symbol: 'AAPL',
			userId: 'user-b'
		} as unknown as TransactionFilters);
		expect(findManyCalls[0]?.where).toEqual({
			symbol: { contains: 'AAPL', mode: 'insensitive' },
			userId: 'user-a'
		});
	});
});

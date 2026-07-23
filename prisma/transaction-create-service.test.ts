import { beforeEach, describe, expect, test } from 'bun:test';
import { resetAiTables, seedUser } from '../src/server/ai/evals/db-support';
import { db } from '../src/server/db';
import { createTransaction } from '../src/server/services/transactions';

describe('createTransaction service', () => {
	let userId: string;
	beforeEach(async () => {
		await resetAiTables();
		userId = await seedUser('a');
		// Seed a watchlist item so callers don't need Yahoo; the service itself does no Yahoo.
		await db.watchlistItem.create({ data: { symbol: 'AAPL', userId } });
	});

	test('writes a transaction row and returns its id', async () => {
		const { id } = await createTransaction(userId, {
			date: new Date('2026-01-02'),
			price: 150,
			priceCurrency: 'USD',
			quantity: 10,
			side: 'BUY',
			symbol: 'AAPL'
		});
		const row = await db.transaction.findUnique({ where: { id } });
		expect(row?.userId).toBe(userId);
		expect(row?.symbol).toBe('AAPL');
		expect(row?.quantity).toBe(10);
		expect(row?.side).toBe('BUY');
	});

	test('upserts the symbol into the watchlist (idempotent)', async () => {
		await createTransaction(userId, {
			date: new Date('2026-01-02'),
			price: 5,
			priceCurrency: 'USD',
			quantity: 1,
			side: 'BUY',
			symbol: 'MSFT'
		});
		const wl = await db.watchlistItem.findUnique({ where: { userId_symbol: { symbol: 'MSFT', userId } } });
		expect(wl).not.toBeNull();
	});
});

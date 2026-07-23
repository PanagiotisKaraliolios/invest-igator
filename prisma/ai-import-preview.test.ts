import { beforeEach, describe, expect, test } from 'bun:test';
import { previewImport } from '../src/server/api/routers/ai-import';
import { resetAiTables, seedUser } from '../src/server/ai/evals/db-support';
import { db } from '../src/server/db';

// A fake mapColumns that returns a fixed mapping — the preview pipeline (parse→apply→validate→dedup)
// is what we assert on, not the LLM.
const fakeMap = async () => ({
	date: 0, symbol: 1, side: 2, quantity: 3, price: 4,
	priceCurrency: null, fee: null, feeCurrency: null, note: null,
	dateFormat: 'MDY_SLASH' as const, sideMap: [{ from: 'B', to: 'BUY' as const }, { from: 'S', to: 'SELL' as const }]
});
const csv = 'Trade Date,Ticker,Action,Qty,Price\n01/15/2026,AAPL,B,10,150.5\n01/16/2026,,S,1,2';

describe('previewImport', () => {
	let userId: string;
	beforeEach(async () => { await resetAiTables(); userId = await seedUser('prev'); });

	test('maps arbitrary headers, classifies rows, flags a bad row as needs-fix', async () => {
		const out = await previewImport(userId, csv, fakeMap);
		expect(out.rows).toHaveLength(2);
		const ok = out.rows.find((r) => r.status === 'ok');
		expect(ok?.values.symbol).toBe('AAPL');
		expect(ok?.values.date).toBe('2026-01-15');
		expect(out.rows.some((r) => r.status === 'needs-fix')).toBe(true); // empty symbol
		expect(out.stats.total).toBe(2);
	});

	test('flags a row that duplicates an existing transaction', async () => {
		await db.transaction.create({ data: {
			date: new Date('2026-01-15T00:00:00Z'), price: 150.5, priceCurrency: 'USD', quantity: 10,
			side: 'BUY', symbol: 'AAPL', userId
		} });
		const out = await previewImport(userId, csv, fakeMap);
		expect(out.rows.some((r) => r.status === 'duplicate')).toBe(true);
	});
});

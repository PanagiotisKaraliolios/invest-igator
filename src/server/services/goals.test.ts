import { beforeEach, describe, expect, mock, test } from 'bun:test';

type FindManyArgs = { orderBy?: unknown; where?: Record<string, unknown> };
const findManyCalls: FindManyArgs[] = [];

const GOALS = [
	{
		createdAt: new Date('2024-01-01T00:00:00.000Z'),
		id: 'g1',
		note: 'six months expenses',
		targetAmount: 10_000,
		targetCurrency: 'USD',
		targetDate: new Date('2027-12-31T00:00:00.000Z'),
		title: 'Emergency Fund',
		updatedAt: new Date('2024-01-01T00:00:00.000Z'),
		userId: 'user-a'
	}
];

mock.module('@/server/db', () => ({
	db: {
		goal: {
			findMany: async (args: FindManyArgs) => {
				findManyCalls.push(args);
				return GOALS;
			}
		}
	}
}));

const { listGoalRecords, listGoals, toGoalRow } = await import('./goals');

beforeEach(() => {
	findManyCalls.length = 0;
});

describe('toGoalRow', () => {
	test('renders targetDate as yyyy-mm-dd', () => {
		expect(
			toGoalRow({
				id: 'g1',
				note: 'six months expenses',
				targetAmount: 10_000,
				targetCurrency: 'USD',
				targetDate: new Date('2027-12-31T00:00:00.000Z'),
				title: 'Emergency Fund'
			})
		).toEqual({
			id: 'g1',
			note: 'six months expenses',
			targetAmount: 10_000,
			targetCurrency: 'USD',
			targetDate: '2027-12-31',
			title: 'Emergency Fund'
		});
	});

	test('a goal with no target date maps to null, not the epoch', () => {
		const row = toGoalRow({
			id: 'g2',
			note: null,
			targetAmount: 500,
			targetCurrency: 'EUR',
			targetDate: null,
			title: 'New laptop'
		});
		expect(row.targetDate).toBeNull();
		expect(row.note).toBeNull();
	});
});

describe('listGoals — THE TENANT KEY REACHES THE QUERY', () => {
	test('scopes to the caller and keeps the router ordering', async () => {
		const rows = await listGoals('user-a');
		expect(findManyCalls).toEqual([
			{ orderBy: [{ targetDate: 'asc' }, { createdAt: 'desc' }], where: { userId: 'user-a' } }
		]);
		expect(rows.map((g) => g.id)).toEqual(['g1']);
		expect(Object.keys(rows[0] ?? {})).not.toContain('userId');

		const records = await listGoalRecords('user-a');
		expect(records[0]?.userId).toBe('user-a');
		expect(findManyCalls[1]?.where).toEqual({ userId: 'user-a' });
	});
});

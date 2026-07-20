import type { Goal } from '@prisma/generated';
import { db } from '@/server/db';

export type GoalRow = {
	id: string;
	title: string;
	targetAmount: number;
	targetCurrency: string;
	targetDate: string | null; // yyyy-mm-dd
	note: string | null;
};

export type GoalRecord = Pick<Goal, 'id' | 'note' | 'targetAmount' | 'targetCurrency' | 'targetDate' | 'title'>;

export function toGoalRow(g: GoalRecord): GoalRow {
	return {
		id: g.id,
		note: g.note ?? null,
		targetAmount: g.targetAmount,
		targetCurrency: g.targetCurrency,
		targetDate: g.targetDate ? g.targetDate.toISOString().slice(0, 10) : null,
		title: g.title
	};
}

/** Full Prisma records, in the router's historical order. The tRPC router returns these verbatim. */
export async function listGoalRecords(userId: string): Promise<Goal[]> {
	return db.goal.findMany({
		orderBy: [{ targetDate: 'asc' }, { createdAt: 'desc' }],
		where: { userId }
	});
}

export async function listGoals(userId: string): Promise<GoalRow[]> {
	const goals = await listGoalRecords(userId);
	return goals.map(toGoalRow);
}

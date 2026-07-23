import type { Currency } from '@/lib/currency';
import { db } from '@/server/db';
import type { Scope, ToolCtx } from './tools/types';

/** Phase 1 grants every read scope and no write scope. */
export const ALL_READ_SCOPES: ReadonlySet<Scope> = new Set<Scope>([
	'portfolio:read',
	'transactions:read',
	'watchlist:read',
	'goals:read',
	'fx:read'
]);

/**
 * THE only sanctioned way to build a ToolCtx for a real request. userId comes from the
 * authenticated session — never from request body or model input — which is what stops a
 * caller from hand-writing `{ userId: someOtherId }` (the Phase 0 concern: ToolCtx was a
 * bare type). Currency is the user's saved preference (default USD), matching the dashboard's
 * currency router (`getCurrency`). Scopes default to ALL_READ_SCOPES for chat; the MCP route
 * passes the bearer key's own scope set.
 */
export async function createToolCtx(
	session: { user: { id: string } },
	surface: ToolCtx['surface'],
	scopes: ReadonlySet<Scope> = ALL_READ_SCOPES
): Promise<ToolCtx> {
	const userId = session.user.id;
	const user = await db.user.findUnique({ select: { currency: true }, where: { id: userId } });
	const currency = (user?.currency ?? 'USD') as Currency;
	return { currency, scopes, surface, userId };
}

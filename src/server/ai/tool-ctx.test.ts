import { describe, expect, mock, test } from 'bun:test';

// This suite mocks `@/server/db` — the hermetic `src/**` unit job never starts Postgres. Mirrors
// the pattern in resolve-model.test.ts (mock only the fields this module touches).
const findUniqueArgs: unknown[] = [];
const currencyByUser: Record<string, string | null> = {
	'user-eur': 'EUR',
	'user-no-currency': null
};

mock.module('@/server/db', () => ({
	db: {
		user: {
			findUnique: async (args: { where: { id: string } }) => {
				findUniqueArgs.push(args);
				return { currency: currencyByUser[args.where.id] ?? null };
			}
		}
	}
}));

const { ALL_READ_SCOPES, CHAT_SCOPES, createToolCtx } = await import('./tool-ctx');

describe('createToolCtx', () => {
	test('userId comes from the session, not any argument', async () => {
		const ctx = await createToolCtx({ user: { id: 'user-123' } }, 'chat');
		expect(ctx.userId).toBe('user-123');
		expect(ctx.surface).toBe('chat');
		// SECURITY: the currency lookup itself must be scoped to the session's userId — a
		// factory that queried some other id could leak another user's currency preference.
		const args = findUniqueArgs.at(-1) as { where?: { id?: string } } | undefined;
		expect(args?.where?.id).toBe('user-123');
	});

	test('grants exactly the five read scopes and no write scope', async () => {
		const ctx = await createToolCtx({ user: { id: 'user-123' } }, 'chat');
		expect([...ctx.scopes].sort()).toEqual([
			'fx:read',
			'goals:read',
			'portfolio:read',
			'transactions:read',
			'watchlist:read'
		]);
		expect([...ctx.scopes].some((s) => s.endsWith(':write'))).toBe(false);
	});

	test('defaults currency to USD when the user has none set', async () => {
		const ctx = await createToolCtx({ user: { id: 'user-no-currency' } }, 'chat');
		expect(ctx.currency).toBe('USD');
	});

	test("passes through the user's saved non-default currency", async () => {
		const ctx = await createToolCtx({ user: { id: 'user-eur' } }, 'chat');
		expect(ctx.currency).toBe('EUR');
	});

	test('honors an explicit scope set and still sources userId from the session arg', async () => {
		const ctx = await createToolCtx({ user: { id: 'u-scoped' } }, 'mcp', new Set(['portfolio:read'] as const));
		expect(ctx.userId).toBe('u-scoped');
		expect(ctx.surface).toBe('mcp');
		expect([...ctx.scopes]).toEqual(['portfolio:read']);
	});

	test('defaults to ALL_READ_SCOPES when no scope set is passed (chat behavior unchanged)', async () => {
		const ctx = await createToolCtx({ user: { id: 'u-default' } }, 'chat');
		expect(ctx.scopes).toBe(ALL_READ_SCOPES);
	});
});

describe('ALL_READ_SCOPES', () => {
	test('is exactly the five read scopes, no write scopes', () => {
		expect([...ALL_READ_SCOPES].sort()).toEqual([
			'fx:read',
			'goals:read',
			'portfolio:read',
			'transactions:read',
			'watchlist:read'
		]);
	});
});

describe('CHAT_SCOPES', () => {
	test('adds transactions:write to the read scopes (so chat can reach the write tool)', () => {
		expect(CHAT_SCOPES.has('transactions:write')).toBe(true);
		expect(CHAT_SCOPES.has('portfolio:read')).toBe(true);
	});

	test('is a strict superset of ALL_READ_SCOPES', () => {
		for (const s of ALL_READ_SCOPES) expect(CHAT_SCOPES.has(s)).toBe(true);
	});
});

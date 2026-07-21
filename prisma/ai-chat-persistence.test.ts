import { beforeEach, describe, expect, test } from 'bun:test';
import type { UIMessage } from 'ai';
import { createChat, deriveTitle, loadTurnHistory, saveTurn } from '../src/server/ai/chat/persistence';
import { resetAiTables, seedUser } from '../src/server/ai/evals/db-support';
import { db } from '../src/server/db';

/**
 * `persistence.ts` is the ownership-scoped data layer the chat gateway (Task 5) and route
 * (Task 6) use to create chats, load prior turns to feed the model, and save a finished turn.
 * The brief's own test snippet is written as if it could create users/chats directly and assert
 * against them hermetically, but the `src/**` unit suite (`bun test --isolate src`) MOCKS
 * `@/server/db` — it cannot do `upsert`, ordered `findMany`, or prove relational ownership, so a
 * hermetic test here would be a lie. This file lives outside `src/` (alongside
 * `ai-quota.test.ts` and `ai-tool-authz.test.ts`) so `bun test --isolate src` stays hermetic,
 * gated instead by `db_tests` via `bun run test:db`, and asserts against a REAL Postgres.
 *
 * The two ownership tests below are the security core: a user must never be able to read or
 * overwrite another user's chat. Both use two distinct seeded users so the gate is proven for
 * real, not simulated.
 */

const msg = (id: string, role: 'assistant' | 'user', text: string): UIMessage => ({
	id,
	parts: [{ text, type: 'text' }],
	role
});

describe('deriveTitle (pure — no DB)', () => {
	test('trims to 60 chars and falls back to "New chat"', () => {
		expect(deriveTitle('  How is my portfolio?  ')).toBe('How is my portfolio?');
		expect(deriveTitle('')).toBe('New chat');
		expect(deriveTitle('x'.repeat(80))).toHaveLength(60);
	});

	test('uses only the first line of multi-line text', () => {
		expect(deriveTitle('First line\nSecond line')).toBe('First line');
	});

	test('a whitespace-only string falls back to "New chat"', () => {
		expect(deriveTitle('   \n  ')).toBe('New chat');
	});
});

describe('Tier 0 (DB) — chat persistence: ownership-scoped create/load/save', () => {
	beforeEach(async () => {
		await resetAiTables();
	});

	test('createChat scopes the chat to userId and stores the given title', async () => {
		const userId = await seedUser('owner');
		const { id: chatId } = await createChat(userId, 'My title');
		const chat = await db.aiChat.findUniqueOrThrow({ where: { id: chatId } });
		expect(chat.userId).toBe(userId);
		expect(chat.title).toBe('My title');
	});

	test('saveTurn then loadTurnHistory round-trips parts, in order, for the owner', async () => {
		const userId = await seedUser('owner');
		const { id: chatId } = await createChat(userId, 'T');
		await saveTurn({
			chatId,
			messages: [msg('m1', 'user', 'hi'), msg('m2', 'assistant', 'hello')],
			userId
		});
		const loaded = await loadTurnHistory(chatId, userId);
		expect(loaded.map((m) => m.id)).toEqual(['m1', 'm2']);
		expect(loaded[1]?.parts).toEqual([{ text: 'hello', type: 'text' }]);
	});

	test('saveTurn upserts by message id: a repeat call with the same id updates parts, not a duplicate row', async () => {
		const userId = await seedUser('owner');
		const { id: chatId } = await createChat(userId, 'T');
		await saveTurn({ chatId, messages: [msg('m1', 'user', 'first draft')], userId });
		await saveTurn({ chatId, messages: [msg('m1', 'user', 'edited')], userId });
		const loaded = await loadTurnHistory(chatId, userId);
		expect(loaded).toHaveLength(1);
		expect(loaded[0]?.parts).toEqual([{ text: 'edited', type: 'text' }]);
	});

	test('saveTurn bumps AiChat.updatedAt', async () => {
		const userId = await seedUser('owner');
		const { id: chatId } = await createChat(userId, 'T');
		const before = await db.aiChat.findUniqueOrThrow({ select: { updatedAt: true }, where: { id: chatId } });
		await new Promise((resolve) => setTimeout(resolve, 5));
		await saveTurn({ chatId, messages: [msg('m1', 'user', 'hi')], userId });
		const after = await db.aiChat.findUniqueOrThrow({ select: { updatedAt: true }, where: { id: chatId } });
		expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
	});

	test('loadTurnHistory returns [] for a chat the user does not own — the read side of the ownership gate', async () => {
		const owner = await seedUser('owner');
		const other = await seedUser('other');
		const { id: chatId } = await createChat(owner, 'T');
		await saveTurn({ chatId, messages: [msg('m1', 'user', 'secret')], userId: owner });

		expect(await loadTurnHistory(chatId, other)).toEqual([]);
		// The owner's own view is unaffected by the foreign read attempt.
		expect((await loadTurnHistory(chatId, owner)).map((m) => m.id)).toEqual(['m1']);
	});

	test('loadTurnHistory returns [] for a chatId that does not exist at all', async () => {
		const userId = await seedUser('owner');
		expect(await loadTurnHistory('does-not-exist', userId)).toEqual([]);
	});

	test('saveTurn silently no-ops on a chat the user does not own — the write side of the ownership gate', async () => {
		const owner = await seedUser('owner');
		const other = await seedUser('other');
		const { id: chatId } = await createChat(owner, 'T');

		await saveTurn({ chatId, messages: [msg('x', 'user', 'inject')], userId: other });

		// Nothing landed at all — not under the attacker's view, not under the real owner's.
		expect(await loadTurnHistory(chatId, other)).toEqual([]);
		expect(await loadTurnHistory(chatId, owner)).toEqual([]);
		expect(await db.aiMessage.count({ where: { chatId } })).toBe(0);
	});

	test("saveTurn on a foreign chat does not corrupt the chat's own updatedAt", async () => {
		const owner = await seedUser('owner');
		const other = await seedUser('other');
		const { id: chatId } = await createChat(owner, 'T');
		const before = await db.aiChat.findUniqueOrThrow({ select: { updatedAt: true }, where: { id: chatId } });

		await saveTurn({ chatId, messages: [msg('x', 'user', 'inject')], userId: other });

		const after = await db.aiChat.findUniqueOrThrow({ select: { updatedAt: true }, where: { id: chatId } });
		expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
	});
});

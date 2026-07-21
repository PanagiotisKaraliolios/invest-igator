import { beforeEach, describe, expect, test } from 'bun:test';
import { createCaller } from '../src/server/api/root';
import type { createTRPCContext } from '../src/server/api/trpc';
import { resetAiTables, seedUser } from '../src/server/ai/evals/db-support';
import { db } from '../src/server/db';

/**
 * `ai-chat.ts` is a relational router: `rename`/`delete` are count-based ownership checks
 * (`updateMany`/`deleteMany` + `count`), and `get` composes a `findFirst` ownership check with
 * `loadTurnHistory` (Task 3), which itself reads both `aiChat` and `aiMessage`. None of that can
 * be faithfully exercised by the `src/**` mocked-`@/server/db` pattern (`ai-credentials.test.ts`)
 * without re-implementing Prisma's relational semantics in a fake — so, like
 * `ai-chat-persistence.test.ts`, this lives under `prisma/` against a REAL Postgres, gated by
 * `test:db` rather than the hermetic `bun test --isolate src` (`test:unit`) run.
 *
 * The ownership tests are the security core: two DISTINCT seeded users, and every mutating or
 * reading procedure must refuse to touch or reveal a chat it doesn't own.
 */

type Ctx = Awaited<ReturnType<typeof createTRPCContext>>;

function callerFor(userId: string) {
	const ctx = {
		apiKeyPermissions: null,
		db,
		headers: new Headers(),
		session: {
			session: { id: 'test-session', token: 'test', userId },
			user: { email: `${userId}@invest-igator.test`, id: userId, name: 'test', role: 'user' }
		}
	} as unknown as Ctx;
	return createCaller(ctx);
}

describe('aiChat router', () => {
	beforeEach(async () => {
		await resetAiTables();
	});

	test("list returns only the caller's chats, newest first", async () => {
		const me = await seedUser('list-me');
		const other = await seedUser('list-other');
		const older = await db.aiChat.create({ data: { title: 'mine-old', userId: me } });
		// Ensure a distinct, later `updatedAt` for the second chat regardless of clock resolution.
		await new Promise((resolve) => setTimeout(resolve, 5));
		const newer = await db.aiChat.create({ data: { title: 'mine-new', userId: me } });
		await db.aiChat.create({ data: { title: 'theirs', userId: other } });

		const chats = await callerFor(me).aiChat.list();
		expect(chats.map((c) => c.id)).toEqual([newer.id, older.id]);
		expect(chats.map((c) => c.title)).toEqual(['mine-new', 'mine-old']);
	});

	test('list is scoped to the caller — never returns another user’s chats', async () => {
		const me = await seedUser('list-scope-me');
		const other = await seedUser('list-scope-other');
		await db.aiChat.create({ data: { title: 'theirs', userId: other } });
		expect(await callerFor(me).aiChat.list()).toEqual([]);
	});

	test('get returns the chat with its message history for the owner', async () => {
		const me = await seedUser('get-me');
		const chat = await db.aiChat.create({ data: { title: 'my chat', userId: me } });
		await db.aiMessage.create({
			data: { chatId: chat.id, id: 'm1', parts: [{ text: 'hi', type: 'text' }], role: 'user' }
		});

		const result = await callerFor(me).aiChat.get({ chatId: chat.id });
		expect(result.id).toBe(chat.id);
		expect(result.title).toBe('my chat');
		expect(result.messages.map((m) => m.id)).toEqual(['m1']);
	});

	test('get throws NOT_FOUND for a chat owned by another user', async () => {
		const me = await seedUser('get-nf-me');
		const other = await seedUser('get-nf-other');
		const chat = await db.aiChat.create({ data: { title: 'x', userId: other } });
		await expect(callerFor(me).aiChat.get({ chatId: chat.id })).rejects.toThrow(/not found/i);
	});

	test('get throws NOT_FOUND for a chatId that does not exist at all', async () => {
		const me = await seedUser('get-missing-me');
		await expect(callerFor(me).aiChat.get({ chatId: 'does-not-exist' })).rejects.toThrow(/not found/i);
	});

	test('rename updates the title for the owner', async () => {
		const me = await seedUser('rename-me');
		const chat = await db.aiChat.create({ data: { title: 'old', userId: me } });
		const result = await callerFor(me).aiChat.rename({ chatId: chat.id, title: 'new title' });
		expect(result).toEqual({ ok: true });
		const updated = await db.aiChat.findUniqueOrThrow({ where: { id: chat.id } });
		expect(updated.title).toBe('new title');
	});

	test('rename a foreign chat throws NOT_FOUND and leaves the title intact', async () => {
		const me = await seedUser('rename-nf-me');
		const other = await seedUser('rename-nf-other');
		const chat = await db.aiChat.create({ data: { title: 'original', userId: other } });
		await expect(callerFor(me).aiChat.rename({ chatId: chat.id, title: 'hijacked' })).rejects.toThrow(
			/not found/i
		);
		const untouched = await db.aiChat.findUniqueOrThrow({ where: { id: chat.id } });
		expect(untouched.title).toBe('original');
	});

	test('delete removes the chat for the owner', async () => {
		const me = await seedUser('delete-me');
		const chat = await db.aiChat.create({ data: { title: 'x', userId: me } });
		const result = await callerFor(me).aiChat.delete({ chatId: chat.id });
		expect(result).toEqual({ ok: true });
		expect(await db.aiChat.findUnique({ where: { id: chat.id } })).toBeNull();
	});

	test('delete a foreign chat throws NOT_FOUND and leaves it intact', async () => {
		const me = await seedUser('delete-nf-me');
		const other = await seedUser('delete-nf-other');
		const chat = await db.aiChat.create({ data: { title: 'x', userId: other } });
		await expect(callerFor(me).aiChat.delete({ chatId: chat.id })).rejects.toThrow(/not found/i);
		expect(await db.aiChat.findUnique({ where: { id: chat.id } })).not.toBeNull();
	});
});

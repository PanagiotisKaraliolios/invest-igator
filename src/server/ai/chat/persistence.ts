import type { UIMessage } from 'ai';
import { db } from '@/server/db';

/** First line, trimmed, capped at 60 chars. Empty/whitespace-only input falls back to 'New chat'. */
export function deriveTitle(firstUserText: string): string {
	const line = firstUserText.split('\n')[0]?.trim() ?? '';
	if (line.length === 0) return 'New chat';
	return line.slice(0, 60);
}

export async function createChat(userId: string, title: string): Promise<{ id: string }> {
	const chat = await db.aiChat.create({ data: { title, userId }, select: { id: true } });
	return { id: chat.id };
}

/**
 * Ownership-scoped. Returns `[]` for a chat the user does not own, or one that does not exist at
 * all — never throws to the caller, and never distinguishes "not yours" from "does not exist" so
 * a caller can't probe for chat ids that belong to someone else.
 */
export async function loadTurnHistory(chatId: string, userId: string): Promise<UIMessage[]> {
	const chat = await db.aiChat.findFirst({ select: { id: true }, where: { id: chatId, userId } });
	if (chat === null) return [];

	const rows = await db.aiMessage.findMany({
		orderBy: { createdAt: 'asc' },
		where: { chatId }
	});
	return rows.map((r) => ({
		id: r.id,
		metadata: r.metadata ?? undefined,
		parts: r.parts as UIMessage['parts'],
		role: r.role as UIMessage['role']
	}));
}

/**
 * Ownership-gated: a chat the caller does not own is a silent no-op, not an error — this must
 * never leak whether a given chatId exists to a user who doesn't own it. Upserts each message by
 * id (so a resend of the same message updates its parts rather than duplicating a row) and bumps
 * `AiChat.updatedAt` so recency-ordered chat lists reflect the new turn.
 */
export async function saveTurn(args: { chatId: string; userId: string; messages: UIMessage[] }): Promise<void> {
	const chat = await db.aiChat.findFirst({ select: { id: true }, where: { id: args.chatId, userId: args.userId } });
	if (chat === null) return;

	for (const m of args.messages) {
		await db.aiMessage.upsert({
			create: {
				chatId: args.chatId,
				id: m.id,
				metadata: (m.metadata ?? undefined) as object | undefined,
				parts: m.parts as object,
				role: m.role
			},
			update: { metadata: (m.metadata ?? undefined) as object | undefined, parts: m.parts as object },
			where: { id: m.id }
		});
	}
	await db.aiChat.update({ data: { updatedAt: new Date() }, where: { id: args.chatId } });
}

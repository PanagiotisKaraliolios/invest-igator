import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { loadTurnHistory } from '@/server/ai/chat/persistence';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';

/**
 * Conversation history CRUD for the chat assistant's history rail. Every procedure is
 * ownership-scoped by `{ id/chatId, userId: ctx.session.user.id }`: mutations use `deleteMany`/
 * `updateMany` and check the returned `count` so a chat owned by another user is a `NOT_FOUND`,
 * never a silent no-op (atomic ownership — no separate read-then-write race).
 */
export const aiChatRouter = createTRPCRouter({
	delete: protectedProcedure.input(z.object({ chatId: z.string() })).mutation(async ({ ctx, input }) => {
		const { count } = await ctx.db.aiChat.deleteMany({ where: { id: input.chatId, userId: ctx.session.user.id } });
		if (count === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found' });
		return { ok: true } as const;
	}),

	get: protectedProcedure.input(z.object({ chatId: z.string() })).query(async ({ ctx, input }) => {
		const chat = await ctx.db.aiChat.findFirst({
			select: { id: true, title: true },
			where: { id: input.chatId, userId: ctx.session.user.id }
		});
		if (chat === null) throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found' });
		const messages = await loadTurnHistory(chat.id, ctx.session.user.id);
		return { id: chat.id, messages, title: chat.title };
	}),

	list: protectedProcedure.query(async ({ ctx }) => {
		return ctx.db.aiChat.findMany({
			orderBy: { updatedAt: 'desc' },
			select: { id: true, title: true, updatedAt: true },
			where: { userId: ctx.session.user.id }
		});
	}),

	rename: protectedProcedure
		.input(z.object({ chatId: z.string(), title: z.string().min(1).max(120) }))
		.mutation(async ({ ctx, input }) => {
			const { count } = await ctx.db.aiChat.updateMany({
				data: { title: input.title },
				where: { id: input.chatId, userId: ctx.session.user.id }
			});
			if (count === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found' });
			return { ok: true } as const;
		})
});

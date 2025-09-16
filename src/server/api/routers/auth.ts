import { TRPCError } from '@trpc/server';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '@/env';
import { createTRPCRouter, protectedProcedure, publicProcedure } from '@/server/api/trpc';

export const authRouter = createTRPCRouter({
	checkEmail: publicProcedure.input(z.email()).mutation(async ({ ctx, input }) => {
		const user = await ctx.db.user.findUnique({ where: { email: input } });
		return { exists: Boolean(user) } as const;
	}),

	signup: publicProcedure
		.input(
			z.object({
				// accept but ignore confirmPassword to keep client compatibility
				confirmPassword: z.string().optional(),
				email: z.email(),
				name: z.string().min(1),
				password: z.string().min(1)
			})
		)
		.mutation(async ({ ctx, input }) => {
			const name = input.name.trim();
			const email = input.email.trim().toLowerCase();
			const password = input.password;

			const existing = await ctx.db.user.findUnique({ where: { email } });
			if (existing) {
				// Throw a TRPC error so clients can catch it in mutateAsync
				throw new TRPCError({
					code: 'CONFLICT',
					message: 'A user with this email already exists'
				});
			}

			const pepper = env.PASSWORD_PEPPER ?? '';
			const passwordHash = await bcrypt.hash(`${password}${pepper}`, 12);
			await ctx.db.user.create({ data: { email, name, passwordHash } });
			return { ok: true } as const;
		})
});

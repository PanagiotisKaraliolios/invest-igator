import { TRPCError } from '@trpc/server';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { env } from '@/env';
import { createTRPCRouter, protectedProcedure, publicProcedure } from '@/server/api/trpc';
import { sendVerificationRequest } from '@/server/auth/send-verification-request';

export const authRouter = createTRPCRouter({
	checkEmail: publicProcedure.input(z.email()).mutation(async ({ ctx, input }) => {
		const user = await ctx.db.user.findUnique({ where: { email: input } });
		return { exists: Boolean(user) } as const;
	}),
	requestPasswordReset: publicProcedure.input(z.object({ email: z.email() })).mutation(async ({ ctx, input }) => {
		const email = input.email.trim().toLowerCase();
		const user = await ctx.db.user.findUnique({ select: { id: true }, where: { email } });
		// Always return ok to avoid account enumeration
		if (!user) return { ok: true } as const;

		const identifier = `pwreset:${email}`;
		const token = randomBytes(32).toString('hex');
		const expires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour
		await ctx.db.verificationToken.deleteMany({ where: { identifier } });
		await ctx.db.verificationToken.create({ data: { expires, identifier, token } });

		const baseUrl = env.BETTER_AUTH_URL;
		const url = `${baseUrl}/forgot-password/reset?token=${encodeURIComponent(token)}`;
		try {
			await sendVerificationRequest({
				expires,
				identifier,
				provider: { from: env.EMAIL_FROM, server: env.EMAIL_SERVER } as any,
				request: new Request(url),
				theme: { brandColor: '#f97316' },
				token,
				url
			});
		} catch {
			if (env.NODE_ENV !== 'production') {
				console.log('[PasswordReset] URL:', url);
			}
		}

		return { ok: true } as const;
	}),

	resetPassword: publicProcedure
		.input(
			z.object({
				password: z.string().min(8).max(200),
				token: z.string().min(10)
			})
		)
		.mutation(async ({ ctx, input }) => {
			const rec = await ctx.db.verificationToken.findUnique({ where: { token: input.token } });
			if (!rec) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invalid or expired token' });
			if (rec.expires < new Date()) {
				await ctx.db.verificationToken.delete({ where: { token: input.token } });
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Token expired' });
			}
			if (!rec.identifier.startsWith('pwreset:')) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid token type' });
			}
			const email = rec.identifier.replace(/^pwreset:/, '');
			const user = await ctx.db.user.findUnique({ where: { email } });
			if (!user) {
				await ctx.db.verificationToken.delete({ where: { token: input.token } });
				throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
			}

			const pepper = env.PASSWORD_PEPPER ?? '';
			const hash = await bcrypt.hash(`${input.password}${pepper}`, 12);
			await ctx.db.$transaction([
				ctx.db.user.update({ data: { passwordHash: hash }, where: { id: user.id } }),
				ctx.db.verificationToken.delete({ where: { token: input.token } })
			]);
			return { ok: true } as const;
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

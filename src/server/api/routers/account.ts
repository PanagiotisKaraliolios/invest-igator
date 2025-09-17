import { TRPCError } from '@trpc/server';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { env } from '@/env';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { sendVerificationRequest } from '@/server/auth/send-verification-request';

export const accountRouter = createTRPCRouter({
	changePassword: protectedProcedure
		.input(
			z.object({
				currentPassword: z.string().min(1),
				newPassword: z.string().min(8).max(200)
			})
		)
		.mutation(async ({ ctx, input }) => {
			const user = await ctx.db.user.findUnique({
				select: { passwordHash: true },
				where: { id: ctx.session.user.id }
			});
			if (!user?.passwordHash) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Password change not available for this account.'
				});
			}
			const pepper = env.PASSWORD_PEPPER ?? '';
			const ok = await bcrypt.compare(`${input.currentPassword}${pepper}`, user.passwordHash);
			if (!ok) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Current password is incorrect' });
			const nextHash = await bcrypt.hash(`${input.newPassword}${pepper}`, 12);
			await ctx.db.user.update({ data: { passwordHash: nextHash }, where: { id: ctx.session.user.id } });
			return { ok: true } as const;
		}),

	confirmEmailChange: protectedProcedure
		.input(z.object({ token: z.string().min(10) }))
		.mutation(async ({ ctx, input }) => {
			const rec = await ctx.db.emailChangeToken.findUnique({ where: { token: input.token } });
			if (!rec) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invalid or expired token' });
			if (rec.expiresAt < new Date()) {
				await ctx.db.emailChangeToken.delete({ where: { token: input.token } });
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Token expired' });
			}

			// Final conflict check
			const exists = await ctx.db.user.findUnique({ where: { email: rec.newEmail } });
			if (exists) {
				await ctx.db.emailChangeToken.delete({ where: { token: input.token } });
				throw new TRPCError({ code: 'CONFLICT', message: 'Email already in use' });
			}

			await ctx.db.$transaction([
				ctx.db.user.update({
					data: { email: rec.newEmail, emailVerified: new Date() },
					where: { id: rec.userId }
				}),
				ctx.db.emailChangeToken.delete({ where: { token: input.token } })
			]);
			return { ok: true } as const;
		}),

	deleteAccount: protectedProcedure.input(z.object({ confirm: z.literal(true) })).mutation(async ({ ctx }) => {
		// Cascade relations are set in Prisma schema
		await ctx.db.user.delete({ where: { id: ctx.session.user.id } });
		return { ok: true } as const;
	}),
	getProfile: protectedProcedure.query(async ({ ctx }) => {
		const user = await ctx.db.user.findUnique({
			select: { email: true, id: true, image: true, name: true, theme: true },
			where: { id: ctx.session.user.id }
		});
		if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
		return user;
	}),
	requestEmailChange: protectedProcedure
		.input(z.object({ currentPassword: z.string().optional(), newEmail: z.string().email() }))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const user = await ctx.db.user.findUnique({
				select: { email: true, passwordHash: true },
				where: { id: userId }
			});
			if (!user) throw new TRPCError({ code: 'NOT_FOUND' });

			// If user has a password, require correct current password
			if (user.passwordHash) {
				if (!input.currentPassword)
					throw new TRPCError({ code: 'BAD_REQUEST', message: 'Current password required' });
				const ok = await bcrypt.compare(
					`${input.currentPassword}${env.PASSWORD_PEPPER ?? ''}`,
					user.passwordHash
				);
				if (!ok) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Current password is incorrect' });
			}

			// Ensure email not already used
			const exists = await ctx.db.user.findUnique({ where: { email: input.newEmail } });
			if (exists) throw new TRPCError({ code: 'CONFLICT', message: 'Email already in use' });

			// Create token
			const token = randomBytes(32).toString('hex');
			const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour
			// Upsert: optionally clear existing pending tokens
			await ctx.db.emailChangeToken.deleteMany({ where: { userId } });
			await ctx.db.emailChangeToken.create({ data: { expiresAt, newEmail: input.newEmail, token, userId } });

			// Send email with confirmation link (reuse nodemailer via EmailProvider-style server)
			const baseUrl = env.NEXT_PUBLIC_SITE_URL;
			const url = `${baseUrl}/api/email-change/confirm?token=${encodeURIComponent(token)}`;
			// We can leverage the existing nodemailer config; keep it simple here
			try {
				await sendVerificationRequest({
					expires: expiresAt,
					identifier: input.newEmail,
					provider: { from: env.EMAIL_FROM, server: env.EMAIL_SERVER } as any,
					request: new Request(url),
					theme: { brandColor: '#f97316' },
					token,
					url
				});
			} catch {
				// If custom mailer fails, at least return the URL in dev
				if (env.NODE_ENV !== 'production') {
					console.log('[EmailChange] Confirm URL:', url);
				}
			}

			return { ok: true } as const;
		}),

	updateProfile: protectedProcedure
		.input(
			z.object({
				image: z.string().url().optional().or(z.literal('')),
				name: z.string().min(1).max(100)
			})
		)
		.mutation(async ({ ctx, input }) => {
			const data: { name: string; image?: string | null } = { name: input.name.trim() };
			if (typeof input.image !== 'undefined') {
				data.image = input.image === '' ? null : input.image;
			}
			await ctx.db.user.update({ data, select: { id: true }, where: { id: ctx.session.user.id } });
			return { ok: true } as const;
		})
});

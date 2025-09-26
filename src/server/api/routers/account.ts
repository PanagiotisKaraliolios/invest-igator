import { TRPCError } from '@trpc/server';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { env } from '@/env';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { sendVerificationRequest } from '@/server/auth/send-verification-request';
import {
	createRecoveryCodes,
	findMatchingRecoveryCode,
	generateTwoFactorSecret,
	verifyTotpToken
} from '@/server/auth/two-factor';

export const accountRouter = createTRPCRouter({
	cancelTwoFactorSetup: protectedProcedure.mutation(async ({ ctx }) => {
		const user = await ctx.db.user.findUnique({
			select: { twoFactorEnabled: true },
			where: { id: ctx.session.user.id }
		});
		if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
		if (user.twoFactorEnabled) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: 'Two-factor authentication is enabled. Disable it instead.'
			});
		}
		await ctx.db.user.update({
			data: {
				twoFactorConfirmedAt: null,
				twoFactorRecoveryCodes: [],
				twoFactorSecret: null
			},
			where: { id: ctx.session.user.id }
		});
		return { ok: true } as const;
	}),
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

			// Prevent reusing the current password
			const sameAsCurrent = await bcrypt.compare(`${input.newPassword}${pepper}`, user.passwordHash);
			if (sameAsCurrent) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'New password must be different from current password'
				});
			}
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

	confirmTwoFactorSetup: protectedProcedure
		.input(z.object({ code: z.string().min(6).max(20) }))
		.mutation(async ({ ctx, input }) => {
			const user = await ctx.db.user.findUnique({
				select: { twoFactorEnabled: true, twoFactorSecret: true },
				where: { id: ctx.session.user.id }
			});
			if (!user?.twoFactorSecret) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'No two-factor setup in progress.' });
			}
			if (user.twoFactorEnabled) return { ok: true } as const;
			const valid = verifyTotpToken(user.twoFactorSecret, input.code);
			if (!valid) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid authentication code.' });
			}
			await ctx.db.user.update({
				data: { twoFactorConfirmedAt: new Date(), twoFactorEnabled: true },
				where: { id: ctx.session.user.id }
			});
			return { ok: true } as const;
		}),

	deleteAccount: protectedProcedure.input(z.object({ confirm: z.literal(true) })).mutation(async ({ ctx }) => {
		// Cascade relations are set in Prisma schema
		await ctx.db.user.delete({ where: { id: ctx.session.user.id } });
		return { ok: true } as const;
	}),

	disableTwoFactor: protectedProcedure
		.input(
			z.object({
				code: z.string().min(6).max(64),
				password: z.string().min(1).optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const user = await ctx.db.user.findUnique({
				select: {
					passwordHash: true,
					twoFactorEnabled: true,
					twoFactorRecoveryCodes: true,
					twoFactorSecret: true
				},
				where: { id: ctx.session.user.id }
			});
			if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
			if (!user.twoFactorEnabled) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Two-factor authentication is not enabled.' });
			}
			const providedPassword = input.password?.trim() ?? '';
			const providedCode = input.code?.trim() ?? '';
			if (user.passwordHash) {
				if (!providedPassword) {
					throw new TRPCError({ code: 'BAD_REQUEST', message: 'Password is required.' });
				}
				const passwordOk = await bcrypt.compare(`${providedPassword}${env.PASSWORD_PEPPER ?? ''}`, user.passwordHash);
				if (!passwordOk) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Password is incorrect.' });
			}
			if (!providedCode) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Authentication code required.' });
			}
			let codeOk = false;
			if (user.twoFactorSecret) {
				codeOk = verifyTotpToken(user.twoFactorSecret, providedCode);
			}
			if (!codeOk && user.twoFactorRecoveryCodes.length > 0) {
				const match = await findMatchingRecoveryCode(providedCode, user.twoFactorRecoveryCodes);
				if (match.matchedHash) {
					codeOk = true;
				}
			}
			if (!codeOk) {
				throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid authentication code.' });
			}
			await ctx.db.user.update({
				data: {
					twoFactorConfirmedAt: null,
					twoFactorEnabled: false,
					twoFactorRecoveryCodes: [],
					twoFactorSecret: null
				},
				where: { id: ctx.session.user.id }
			});
			return { ok: true } as const;
		}),

	disconnectOAuthAccount: protectedProcedure
		.input(z.object({ accountId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const account = await ctx.db.account.findFirst({
				select: { id: true, userId: true },
				where: { id: input.accountId, userId }
			});
			if (!account) throw new TRPCError({ code: 'NOT_FOUND' });

			// Safety: prevent removing last authentication method
			const [accountCount, user] = await Promise.all([
				ctx.db.account.count({ where: { userId } }),
				ctx.db.user.findUnique({ select: { passwordHash: true }, where: { id: userId } })
			]);
			const hasPassword = Boolean(user?.passwordHash);
			if (accountCount <= 1 && !hasPassword) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message:
						'Cannot remove your only sign-in method. Please add another sign-in method (or set a password) before removing this one.'
				});
			}

			await ctx.db.account.delete({ where: { id: input.accountId } });
			return { ok: true } as const;
		}),
	getProfile: protectedProcedure.query(async ({ ctx }) => {
		const user = await ctx.db.user.findUnique({
			select: {
				email: true,
				emailVerified: true,
				id: true,
				image: true,
				name: true,
				passwordHash: true,
				theme: true
			},
			where: { id: ctx.session.user.id }
		});
		if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
		const { passwordHash, ...rest } = user;
		return { ...rest, hasPassword: Boolean(passwordHash) } as const;
	}),

	getTwoFactorState: protectedProcedure.query(async ({ ctx }) => {
		const user = await ctx.db.user.findUnique({
			select: {
				email: true,
				passwordHash: true,
				twoFactorConfirmedAt: true,
				twoFactorEnabled: true,
				twoFactorRecoveryCodes: true,
				twoFactorSecret: true
			},
			where: { id: ctx.session.user.id }
		});
		if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
		return {
			confirmedAt: user.twoFactorConfirmedAt?.toISOString() ?? null,
			enabled: user.twoFactorEnabled,
			hasPassword: Boolean(user.passwordHash),
			hasSecret: Boolean(user.twoFactorSecret),
			pending: Boolean(user.twoFactorSecret && !user.twoFactorEnabled),
			recoveryCodesRemaining: user.twoFactorRecoveryCodes.length
		} as const;
	}),
	listOAuthAccounts: protectedProcedure.query(async ({ ctx }) => {
		const accounts = await ctx.db.account.findMany({
			select: { id: true, provider: true, providerAccountId: true, type: true },
			where: { userId: ctx.session.user.id }
		});
		return accounts;
	}),

	regenerateTwoFactorRecoveryCodes: protectedProcedure
		.input(
			z.object({
				code: z.string().min(6, 'Authentication code is required').max(64),
				password: z.string().min(1, 'Password is required')
			})
		)
		.mutation(async ({ ctx, input }) => {
			const user = await ctx.db.user.findUnique({
				select: {
					passwordHash: true,
					twoFactorEnabled: true,
					twoFactorRecoveryCodes: true,
					twoFactorSecret: true
				},
				where: { id: ctx.session.user.id }
			});
			if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
			if (!user.twoFactorEnabled || !user.twoFactorSecret) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Two-factor authentication must be enabled before regenerating codes.'
				});
			}
			if (!user.passwordHash) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Password verification is required before regenerating codes.' });
			}
			const providedPassword = input.password.trim();
			const passwordOk = await bcrypt.compare(`${providedPassword}${env.PASSWORD_PEPPER ?? ''}`, user.passwordHash);
			if (!passwordOk) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Password is incorrect.' });
			const providedCode = input.code.trim();
			let codeOk = verifyTotpToken(user.twoFactorSecret, providedCode);
			if (!codeOk && user.twoFactorRecoveryCodes.length > 0) {
				const match = await findMatchingRecoveryCode(providedCode, user.twoFactorRecoveryCodes);
				if (match.matchedHash) {
					codeOk = true;
				}
			}
			if (!codeOk) {
				throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid authentication code.' });
			}
			const { hashed, plain } = await createRecoveryCodes();
			await ctx.db.user.update({
				data: { twoFactorRecoveryCodes: hashed },
				where: { id: ctx.session.user.id }
			});
			return { recoveryCodes: plain } as const;
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

	requestEmailVerification: protectedProcedure.mutation(async ({ ctx }) => {
		const userId = ctx.session.user.id;
		const user = await ctx.db.user.findUnique({
			select: { email: true, emailVerified: true },
			where: { id: userId }
		});
		if (!user?.email) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No email on file' });
		if (user.emailVerified) {
			return { ok: true } as const;
		}

		const token = randomBytes(32).toString('hex');
		const expires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour
		// Clear any existing tokens for this identifier
		await ctx.db.verificationToken.deleteMany({ where: { identifier: user.email } });
		await ctx.db.verificationToken.create({ data: { expires, identifier: user.email, token } });

		const baseUrl = env.NEXT_PUBLIC_SITE_URL;
		const url = `${baseUrl}/api/verify-email/confirm?token=${encodeURIComponent(token)}`;
		try {
			await sendVerificationRequest({
				expires,
				identifier: user.email,
				provider: { from: env.EMAIL_FROM, server: env.EMAIL_SERVER } as any,
				request: new Request(url),
				theme: { brandColor: '#f97316' },
				token,
				url
			});
		} catch {
			if (env.NODE_ENV !== 'production') {
				console.log('[VerifyEmail] Confirm URL:', url);
			}
		}

		return { ok: true } as const;
	}),
	setPassword: protectedProcedure
		.input(
			z.object({
				newPassword: z.string().min(8).max(200)
			})
		)
		.mutation(async ({ ctx, input }) => {
			const user = await ctx.db.user.findUnique({
				select: { passwordHash: true },
				where: { id: ctx.session.user.id }
			});
			if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
			if (user.passwordHash) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Password already set. Use change password instead.'
				});
			}
			const pepper = env.PASSWORD_PEPPER ?? '';
			const nextHash = await bcrypt.hash(`${input.newPassword}${pepper}`, 12);
			await ctx.db.user.update({ data: { passwordHash: nextHash }, where: { id: ctx.session.user.id } });
			return { ok: true } as const;
		}),

	startTwoFactorSetup: protectedProcedure.mutation(async ({ ctx }) => {
		const user = await ctx.db.user.findUnique({
			select: { email: true, id: true, twoFactorEnabled: true },
			where: { id: ctx.session.user.id }
		});
		if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
		if (user.twoFactorEnabled) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: 'Two-factor authentication is already enabled.'
			});
		}
		const { otpauthUrl, secret } = generateTwoFactorSecret(user.email ?? `user-${user.id}`);
		const { hashed, plain } = await createRecoveryCodes();
		await ctx.db.user.update({
			data: {
				twoFactorConfirmedAt: null,
				twoFactorEnabled: false,
				twoFactorRecoveryCodes: hashed,
				twoFactorSecret: secret
			},
			where: { id: user.id }
		});
		return { otpauthUrl, recoveryCodes: plain, secret } as const;
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

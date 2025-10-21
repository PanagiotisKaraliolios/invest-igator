import { TRPCError } from '@trpc/server';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { env } from '@/env';
import { auth } from '@/lib/auth';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { sendVerificationRequest } from '@/server/auth/send-verification-request';

export const accountRouter = createTRPCRouter({
	cancelTwoFactorSetup: protectedProcedure.mutation(async ({ ctx }) => {
		const userId = ctx.session.user.id;
		const user = await ctx.db.user.findUnique({
			select: { twoFactorEnabled: true },
			where: { id: userId }
		});

		// Only allow cancellation if 2FA is not yet enabled
		if (user?.twoFactorEnabled) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: 'Cannot cancel an already enabled two-factor authentication'
			});
		}

		// Delete the TwoFactor record to clean up the pending setup
		await ctx.db.twoFactor.deleteMany({
			where: { userId }
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
			// Fetch password from Account table (Better Auth)
			const account = await ctx.db.account.findFirst({
				select: { id: true, password: true },
				where: { providerId: 'credential', userId: ctx.session.user.id }
			});
			if (!account?.password) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Password change not available for this account.'
				});
			}
			const pepper = env.PASSWORD_PEPPER ?? '';
			const ok = await bcrypt.compare(`${input.currentPassword}${pepper}`, account.password);
			if (!ok) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Current password is incorrect' });

			// Prevent reusing the current password
			const sameAsCurrent = await bcrypt.compare(`${input.newPassword}${pepper}`, account.password);
			if (sameAsCurrent) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'New password must be different from current password'
				});
			}
			const nextHash = await bcrypt.hash(`${input.newPassword}${pepper}`, 12);
			await ctx.db.account.update({ data: { password: nextHash }, where: { id: account.id } });
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
					data: { email: rec.newEmail, emailVerified: true, emailVerifiedAt: new Date() },
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
			const accountCount = await ctx.db.account.count({ where: { userId } });
			// Check if user has a credential account (Better Auth)
			const credentialAccount = await ctx.db.account.findFirst({
				select: { password: true },
				where: { providerId: 'credential', userId }
			});
			const hasPassword = Boolean(credentialAccount?.password);
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

	getMe: protectedProcedure.query(async ({ ctx }) => {
		const user = await ctx.db.user.findUnique({
			select: {
				email: true,
				emailVerified: true,
				id: true,
				image: true,
				name: true
			},
			where: { id: ctx.session.user.id }
		});

		if (!user) throw new TRPCError({ code: 'NOT_FOUND' });

		const credentialAccount = await ctx.db.account.findFirst({
			select: { password: true },
			where: { providerId: 'credential', userId: ctx.session.user.id }
		});

		return {
			avatar: user.image,
			email: user.email ?? '',
			emailVerified: Boolean(user.emailVerified),
			hasPassword: Boolean(credentialAccount?.password),
			id: user.id,
			name: user.name ?? user.email ?? 'User'
		} as const;
	}),

	getTwoFactorState: protectedProcedure.query(async ({ ctx }) => {
		const user = await ctx.db.user.findUnique({
			select: {
				email: true,
				twoFactorEnabled: true
			},
			where: { id: ctx.session.user.id }
		});
		if (!user) throw new TRPCError({ code: 'NOT_FOUND' });

		// Check if user has a credential account (Better Auth)
		const credentialAccount = await ctx.db.account.findFirst({
			select: { password: true },
			where: { providerId: 'credential', userId: ctx.session.user.id }
		});

		// Query TwoFactor table for secret and backup codes
		const twoFactor = await ctx.db.twoFactor.findFirst({
			select: {
				backupCodes: true,
				secret: true
			},
			where: { userId: ctx.session.user.id }
		});

		// Better Auth encrypts backup codes, so we use their API to get the actual count
		let recoveryCodesRemaining = 0;
		if (twoFactor?.backupCodes) {
			try {
				const backupCodesData = await auth.api.viewBackupCodes({
					body: {
						userId: ctx.session.user.id
					}
				});

				console.log('🚀 ~ account.ts:166 ~ backupCodesData:', backupCodesData);

				if (backupCodesData && Array.isArray(backupCodesData)) {
					recoveryCodesRemaining = backupCodesData.length;
				}
			} catch {
				// If we can't view backup codes, assume they exist but count is unknown
				recoveryCodesRemaining = 10; // Default assumption
			}
		}

		return {
			confirmedAt: null, // Better Auth doesn't track confirmation time
			enabled: user.twoFactorEnabled,
			hasPassword: Boolean(credentialAccount?.password),
			hasSecret: Boolean(twoFactor?.secret),
			pending: Boolean(twoFactor?.secret && !user.twoFactorEnabled),
			recoveryCodesRemaining
		} as const;
	}),

	listOAuthAccounts: protectedProcedure.query(async ({ ctx }) => {
		const accounts = await ctx.db.account.findMany({
			select: { accountId: true, id: true, providerId: true },
			where: { providerId: { not: 'credential' }, userId: ctx.session.user.id }
		});
		return accounts;
	}),

	requestEmailChange: protectedProcedure
		.input(z.object({ currentPassword: z.string().optional(), newEmail: z.string().email() }))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const user = await ctx.db.user.findUnique({
				select: { email: true },
				where: { id: userId }
			});
			if (!user) throw new TRPCError({ code: 'NOT_FOUND' });

			// Fetch password from Account table (Better Auth)
			const account = await ctx.db.account.findFirst({
				select: { password: true },
				where: { providerId: 'credential', userId }
			});
			// If user has a password, require correct current password
			if (account?.password) {
				if (!input.currentPassword)
					throw new TRPCError({ code: 'BAD_REQUEST', message: 'Current password required' });
				const ok = await bcrypt.compare(
					`${input.currentPassword}${env.PASSWORD_PEPPER ?? ''}`,
					account.password
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
			const baseUrl = env.BETTER_AUTH_URL;
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

	/**
	 * @deprecated This procedure exists for backward compatibility.
	 *
	 * New implementations should use Better Auth's native email verification:
	 *
	 * Client-side:
	 *   import { sendVerificationEmail } from '@/lib/auth-client';
	 *   await sendVerificationEmail({ email: user.email, callbackURL: '/' });
	 *
	 * Better Auth handles the verification at /api/auth/verify-email
	 *
	 * This can be removed once all clients are migrated to Better Auth.
	 */
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

		const baseUrl = env.BETTER_AUTH_URL;
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
			const userId = ctx.session.user.id;
			const user = await ctx.db.user.findUnique({
				select: { email: true },
				where: { id: userId }
			});
			if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
			// Check if user already has a credential account with a password
			const existingAccount = await ctx.db.account.findFirst({
				select: { id: true, password: true },
				where: { providerId: 'credential', userId }
			});

			if (existingAccount?.password) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Password already set. Use change password instead.'
				});
			}
			if (!user.email) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Email is required to set a password.'
				});
			}
			const pepper = env.PASSWORD_PEPPER ?? '';
			const nextHash = await bcrypt.hash(`${input.newPassword}${pepper}`, 12);

			// Create or update Account record for Better Auth
			if (existingAccount) {
				// Update existing account with password
				await ctx.db.account.update({
					data: { password: nextHash },
					where: { id: existingAccount.id }
				});
			} else {
				// Create new Account record
				await ctx.db.account.create({
					data: {
						accountId: user.email,
						password: nextHash,
						providerId: 'credential',
						userId
					}
				});
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
		}),

	uploadProfilePicture: protectedProcedure
		.input(
			z.object({
				dataUrl: z.string().regex(/^data:image\/(png|jpeg|jpg|gif|webp);base64,/)
			})
		)
		.mutation(async ({ ctx, input }) => {
			try {
				const sharp = (await import('sharp')).default;
				const { dataUrlToBuffer, generateProfilePictureKey, uploadToR2 } = await import('@/server/r2');

				// Parse the data URL
				const { buffer } = dataUrlToBuffer(input.dataUrl);

				console.log(`[Upload] Original size: ${(buffer.length / 1024).toFixed(2)}KB`);

				// Compress and optimize the image using Sharp
				const compressedBuffer = await sharp(buffer)
					.resize(512, 512, {
						fit: 'cover',
						position: 'center'
					})
					.jpeg({
						mozjpeg: true,
						progressive: true,
						quality: 85
					})
					.toBuffer();

				console.log(
					`[Upload] Compressed size: ${(compressedBuffer.length / 1024).toFixed(2)}KB (${((1 - compressedBuffer.length / buffer.length) * 100).toFixed(1)}% reduction)`
				);

				// Generate unique key with .jpg extension (since we're converting to JPEG)
				const key = generateProfilePictureKey(ctx.session.user.id, 'jpg');

				// Upload to R2
				const { url } = await uploadToR2(compressedBuffer, key, 'image/jpeg');

				// Update user's profile image
				await ctx.db.user.update({
					data: { image: url },
					where: { id: ctx.session.user.id }
				});

				return { url };
			} catch (error) {
				console.error('Upload error:', error);
				throw new TRPCError({
					code: 'INTERNAL_SERVER_ERROR',
					message: error instanceof Error ? error.message : 'Failed to upload profile picture'
				});
			}
		})
});

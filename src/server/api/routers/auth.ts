import { TRPCError } from '@trpc/server';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { env } from '@/env';
import { createTRPCRouter, protectedProcedure, publicProcedure } from '@/server/api/trpc';
import { sendVerificationRequest } from '@/server/auth/send-verification-request';

/**
 * Auth router - handles authentication operations.
 * All procedures are public (no authentication required).
 *
 * @example
 * // Check if email exists
 * const result = await api.auth.checkEmail.mutate('user@example.com');
 *
 * @example
 * // Sign up a new user
 * await api.auth.signup.mutate({
 *   email: 'user@example.com',
 *   password: 'securepass',
 *   name: 'John Doe'
 * });
 */
export const authRouter = createTRPCRouter({
	/**
	 * Checks if an email address is already registered.
	 * Used for account enumeration prevention and form validation.
	 *
	 * @input Email address to check
	 *
	 * @returns {exists: boolean} Whether the email is registered
	 *
	 * @example
	 * const result = await api.auth.checkEmail.mutate('user@example.com');
	 * if (result.exists) {
	 *   console.log('Email already in use');
	 * }
	 */
	checkEmail: publicProcedure.input(z.email()).mutation(async ({ ctx, input }) => {
		const user = await ctx.db.user.findUnique({ where: { email: input } });
		return { exists: Boolean(user) } as const;
	}),
	/**
	 * Initiates a password reset request.
	 * Sends a reset link to the user's email. Always returns success to prevent account enumeration.
	 *
	 * @input email - Email address for password reset
	 *
	 * @returns {ok: true} Always returns success (even if email not found)
	 *
	 * @example
	 * await api.auth.requestPasswordReset.mutate({ email: 'user@example.com' });
	 */
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

	/**
	 * Resets a user's password using a valid token.
	 * Validates the token, checks expiration, and updates the password hash.
	 *
	 * @input token - Password reset token from email
	 * @input password - New password (min 8, max 200 characters)
	 *
	 * @throws {TRPCError} NOT_FOUND - If token is invalid or user not found
	 * @throws {TRPCError} BAD_REQUEST - If token is expired or wrong type
	 * @returns {ok: true} Success indicator
	 *
	 * @example
	 * await api.auth.resetPassword.mutate({
	 *   token: 'reset_token_from_email',
	 *   password: 'newpassword123'
	 * });
	 */
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

	/**
	 * Creates a new user account with email and password.
	 * Hashes the password with pepper and stores user credentials.
	 *
	 * @input email - User's email address (validated)
	 * @input password - User's password (min 1 character)
	 * @input name - User's display name (min 1 character)
	 * @input confirmPassword - Optional confirmation field (accepted but ignored)
	 *
	 * @throws {TRPCError} CONFLICT - If email already exists
	 * @returns {ok: true} Success indicator
	 *
	 * @example
	 * await api.auth.signup.mutate({
	 *   email: 'newuser@example.com',
	 *   password: 'securepassword',
	 *   name: 'John Doe'
	 * });
	 */
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

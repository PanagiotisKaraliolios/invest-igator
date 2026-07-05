import * as bcrypt from 'bcryptjs';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { admin, magicLink, openAPI, twoFactor } from 'better-auth/plugins';
import { env } from '@/env';
import { formatDeviceInfo, getLocationFromIP } from '@/lib/session-utils';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordSchema } from '@/lib/validation';
import { ac, admin as adminRole, superadmin as superadminRole, user as userRole } from '@/server/auth/permissions';
import { db } from '@/server/db';
import { sendMagicLinkEmail, sendPasswordResetEmail, sendVerificationEmail } from '@/server/email';

export const auth = betterAuth({
	account: {
		accountLinking: {
			enabled: true,
			trustedProviders: ['discord']
		}
	},
	advanced: {
		cookiePrefix: 'better-auth',
		database: {
			generateId: () => {
				// Use cuid() to match existing schema
				const { createId } = require('@paralleldrive/cuid2');
				return createId();
			}
		},
		useSecureCookies: env.NODE_ENV === 'production'
	},
	database: prismaAdapter(db, {
		provider: 'postgresql'
	}),
	emailAndPassword: {
		enabled: true,
		maxPasswordLength: PASSWORD_MAX_LENGTH,
		minPasswordLength: PASSWORD_MIN_LENGTH,
		password: {
			hash: async (password: string) => {
				const pepper = env.PASSWORD_PEPPER ?? '';
				return bcrypt.hash(`${password}${pepper}`, 12);
			},
			verify: async ({ hash, password }: { hash: string; password: string }) => {
				const pepper = env.PASSWORD_PEPPER ?? '';
				return bcrypt.compare(`${password}${pepper}`, hash);
			}
		},
		requireEmailVerification: true,
		sendResetPassword: async ({ user, url }) => {
			// Better Auth generates reset URLs with token in query params
			// The client should call requestPasswordReset({ email, redirectTo }) to trigger this
			// After clicking the link, use resetPassword({ newPassword, token }) to complete reset
			await sendPasswordResetEmail(user.email, url);
		}
	},
	emailVerification: {
		sendOnSignUp: true,
		sendVerificationEmail: async ({ user, url, token }) => {
			// Better Auth generates verification URLs like: /api/auth/verify-email?token=xxx&callbackURL=yyy
			// When user clicks the link, Better Auth handles verification internally
			await sendVerificationEmail(user.email, url, 'verify-email');
		}
	},
	hooks: {
		after: createAuthMiddleware(async (ctx) => {
			// Only run for endpoints that create sessions
			const sessionCreationPaths = [
				'/sign-in/email',
				'/sign-in/social',
				'/sign-up/email',
				'/sign-up/social',
				'/sign-in/magic-link'
			];

			if (!sessionCreationPaths.some((path) => ctx.path.startsWith(path))) {
				return;
			}

			// Get the newly created session
			const newSession = ctx.context.newSession;

			if (!newSession?.session?.id) {
				return;
			}

			try {
				// Extract user agent from request headers
				const userAgent = ctx.headers?.get('user-agent') ?? null;

				// Extract IP address (handle various proxy headers)
				const ipAddress =
					ctx.headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ctx.headers?.get('x-real-ip') ?? null;

				// Parse device info from user agent
				const device = formatDeviceInfo(userAgent);

				// Get location from IP (async, but we don't want to block the response)
				// We'll update the session asynchronously
				getLocationFromIP(ipAddress)
					.then(async (location) => {
						await db.session.update({
							data: {
								device,
								location
							},
							where: { id: newSession.session.id }
						});
					})

					.catch((error) => {
						console.error('Failed to update session with location:', error);
						// Still update with device info even if location fails
						db.session
							.update({
								data: { device },
								where: { id: newSession.session.id }
							})
							.catch((err) => console.error('Failed to update session with device:', err));
					});
			} catch (error) {
				console.error('Error in session enrichment hook:', error);
			}
		}),
		before: createAuthMiddleware(async (ctx) => {
			const passwordUpdatePaths = ['/sign-up/email', '/reset-password', '/change-password', '/set-password'];
			if (!passwordUpdatePaths.some((path) => ctx.path.startsWith(path))) {
				return;
			}

			const candidate =
				typeof ctx.body?.newPassword === 'string'
					? ctx.body.newPassword
					: typeof ctx.body?.password === 'string'
						? ctx.body.password
						: null;

			if (!candidate) {
				return;
			}

			const parsed = passwordSchema.safeParse(candidate);
			if (!parsed.success) {
				throw new APIError('BAD_REQUEST', {
					message: parsed.error.issues[0]?.message ?? 'Password does not meet requirements'
				});
			}
		})
	},
	plugins: [
		openAPI({
			path: '/reference' // Will be served at /api/auth/reference
		}),
		admin({
			ac,
			defaultRole: 'user',
			roles: {
				admin: adminRole,
				superadmin: superadminRole,
				user: userRole
			} as const
		}),
		magicLink({
			disableSignUp: true, // Only allow existing users to login via magic link
			expiresIn: 60 * 5, // 5 minutes
			sendMagicLink: async ({ email, token, url }, request) => {
				// Send magic link email
				await sendMagicLinkEmail(email, url);
			}
		}),
		twoFactor({
			issuer: env.APP_NAME
			// Recovery codes are generated automatically
		}),
		nextCookies()
	],
	rateLimit: {
		customRules: {
			'/change-password': { max: 5, window: 300 },
			'/request-password-reset': { max: 5, window: 300 },
			'/reset-password': { max: 5, window: 300 },
			'/set-password': { max: 5, window: 300 },
			'/sign-in/email': { max: 10, window: 60 },
			'/sign-up/email': { max: 5, window: 300 }
		},
		enabled: true,
		max: 100,
		window: 60
	},
	session: {
		cookie: {
			sameSite: 'lax', // Changed from 'strict' to work better with nginx proxy
			secure: env.NODE_ENV === 'production'
		},
		cookieCache: {
			enabled: false // Disabled to ensure fresh session checks
		},
		expiresIn: 60 * 60 * 24 * 7, // 7 days
		updateAge: 60 * 60 * 24 // 1 day (refresh session every day)
	},
	socialProviders: {
		discord: {
			clientId: env.AUTH_DISCORD_ID,
			clientSecret: env.AUTH_DISCORD_SECRET
		}
	},
	trustedOrigins: [env.NEXT_PUBLIC_SITE_URL, 'https://invest-igator.karaliolios.dev'],
	user: {
		additionalFields: {
			role: {
				defaultValue: 'user',
				required: false,
				type: 'string'
			}
		}
	}
});

export type Session = typeof auth.$Infer.Session.session;
export type User = typeof auth.$Infer.Session.user;

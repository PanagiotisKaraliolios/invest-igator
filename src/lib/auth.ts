import * as bcrypt from 'bcryptjs';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { admin, magicLink, openAPI, twoFactor } from 'better-auth/plugins';
import { env } from '@/env';
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
		requireEmailVerification: false,
		sendResetPassword: async ({ user, url }) => {
			// Better Auth generates reset URLs with token in query params
			// The client should call forgetPassword({ email, redirectTo }) to trigger this
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

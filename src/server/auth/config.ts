import { PrismaAdapter } from '@auth/prisma-adapter';
import bcrypt from 'bcryptjs';
import { CredentialsSignin, type DefaultSession, type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import DiscordProvider from 'next-auth/providers/discord';
import EmailProvider from 'next-auth/providers/nodemailer';
import { env } from '@/env';
// Nodemailer doesn't ship full TypeScript types in this project; import as any to satisfy usage.

import { db } from '@/server/db';
import { sendVerificationRequest } from './send-verification-request';

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module 'next-auth' {
	interface Session extends DefaultSession {
		user: {
			id: string;
			emailVerified?: string | null;
			// ...other properties
			// role: UserRole;
		} & DefaultSession['user'];
	}

	// interface User {
	//   // ...other properties
	//   // role: UserRole;
	// }
}

class InvalidLoginError extends CredentialsSignin {
	code = 'Invalid Email or Password';
}

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
export const authConfig = {
	adapter: PrismaAdapter(db),
	callbacks: {
		jwt({ token, user }) {
			if (user) {
				(token as { id?: string }).id = (user as { id: string }).id;
				const ev = (user as { emailVerified?: Date | null }).emailVerified;
				(token as { emailVerified?: string | null }).emailVerified = ev ? new Date(ev).toISOString() : null;
			}
			return token;
		},
		session: async ({ session, token }) => {
			const t = token as {
				sub?: string;
				id?: string;
				emailVerified?: string | null;
			};
			const id = t.sub ?? t.id;
			if (session.user) {
				// Assign through a cast to avoid TS narrowing issues from module augmentation
				const u = session.user as unknown as {
					id?: string;
					emailVerified?: string | null;
					name?: string | null;
					image?: string | null;
				};
				if (id) u.id = id;
				u.emailVerified = t.emailVerified ?? null;

				// Always reflect latest profile fields in the session
				if (id) {
					const latest = await db.user.findUnique({
						select: { email: true, image: true, name: true },
						where: { id }
					});
					if (latest) {
						u.name = latest.name ?? u.name ?? null;
						u.image = latest.image ?? u.image ?? null;
						// Ensure email in session reflects the latest from DB
						(u as { email?: string | null }).email =
							latest.email ?? (u as { email?: string | null }).email ?? null;
					}
				}
			}
			return session;
		}
	},
	pages: {
		error: '/auth-error',
		signIn: '/login',
		signOut: '/signout',
		verifyRequest: '/verify-request' // (used for check email message)
	},
	providers: [
		DiscordProvider({
			// allowDangerousEmailAccountLinking: true,
		}),
		EmailProvider({
			from: process.env.EMAIL_FROM,
			/**
			 * Before sending a magic link, ensure a user exists for the email.
			 * If not, raise an error that includes a link to the signup page.
			 */
			sendVerificationRequest,
			server: process.env.EMAIL_SERVER
			// maxAge: 24 * 60 * 60, // How long email links are valid for (default 24h)
		}),
		Credentials({
			authorize: async (credentials) => {
				console.log('🚀 ~ config.ts:66 ~ credentials:', credentials);

				// Basic input guards
				const email = credentials?.email?.toString().trim().toLowerCase();
				const password = credentials?.password?.toString();
				if (!email || !password) return null;

				// Fetch user and the stored hash
				const user = await db.user.findUnique({
					select: {
						email: true,
						emailVerified: true,
						id: true,
						image: true,
						name: true,
						passwordHash: true
					},
					where: { email }
				});

				if (!user || !user.passwordHash) {
					// No password set for this user (likely OAuth-only) or user not found
					return null;
				}

				// Compare provided password + app-level pepper with stored bcrypt hash
				const ok = await bcrypt.compare(`${password}${env.PASSWORD_PEPPER}`, user.passwordHash);

				console.log('🚀 ~ config.ts:96 ~ ok:', ok);

				if (!ok) throw new InvalidLoginError();

				// Return a safe user object; NextAuth will include `id` in the session via callback
				return {
					email: user.email,
					emailVerified: user.emailVerified,
					id: user.id,
					image: user.image,
					name: user.name
				};
			},
			credentials: {
				email: { label: 'Email', type: 'email' },
				password: { label: 'Password', type: 'password' }
			}
		})
		/**
		 * ...add more providers here.
		 *
		 * Most other providers require a bit more work than the Discord provider. For example, the
		 * GitHub provider requires you to add the `refresh_token_expires_in` field to the Account
		 * model. Refer to the NextAuth.js docs for the provider you want to use. Example:
		 *
		 * @see https://next-auth.js.org/providers/github
		 */
	],
	session: {
		strategy: 'jwt'
	}
} satisfies NextAuthConfig;

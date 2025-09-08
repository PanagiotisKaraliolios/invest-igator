import { PrismaAdapter } from "@auth/prisma-adapter";
import type { DefaultSession, NextAuthConfig } from "next-auth";
import DiscordProvider from "next-auth/providers/discord";
import EmailProvider from "next-auth/providers/nodemailer";
// Nodemailer doesn't ship full TypeScript types in this project; import as any to satisfy usage.

import { db } from "@/server/db";
import { createTransport } from "nodemailer"
import { sendVerificationRequest } from "./send-verification-request";

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
	interface Session extends DefaultSession {
		user: {
			id: string;
			// ...other properties
			// role: UserRole;
		} & DefaultSession["user"];
	}

	// interface User {
	//   // ...other properties
	//   // role: UserRole;
	// }
}

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
export const authConfig = {
	pages: {
		signIn: "/login",
		error: "/auth-error",
		verifyRequest: "/verify-request", // (used for check email message)
	},
	providers: [
		DiscordProvider({
			// allowDangerousEmailAccountLinking: true,
		}),
		EmailProvider({
			server: process.env.EMAIL_SERVER,
			from: process.env.EMAIL_FROM,
			/**
			 * Before sending a magic link, ensure a user exists for the email.
			 * If not, raise an error that includes a link to the signup page.
			 */
			sendVerificationRequest,
			// maxAge: 24 * 60 * 60, // How long email links are valid for (default 24h)
		}),
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
	adapter: PrismaAdapter(db),
	callbacks: {
		session: ({ session, user }) => ({
			...session,
			user: {
				...session.user,
				id: user.id,
			},
		}),
	},
} satisfies NextAuthConfig;

import * as bcrypt from 'bcryptjs';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { twoFactor } from 'better-auth/plugins';
import { createTransport } from 'nodemailer';
import { env } from '@/env';
import { db } from '@/server/db';

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
		}
	},
	baseURL: env.NEXT_PUBLIC_SITE_URL,
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
			const transport = createTransport(env.EMAIL_SERVER);
			const host = new URL(url).host;

			await transport.sendMail({
				from: env.EMAIL_FROM,
				html: createEmailHtml({
					cta: 'Reset password',
					footer: 'If you did not request a password reset, you can safely ignore this email.',
					heading: `Reset your password for <strong>${host.replace(/\./g, '&#8203;.')}</strong>`,
					host,
					url
				}),
				subject: `Reset your password — ${host}`,
				text: `Reset your password — ${host}\n${url}\n\n`,
				to: user.email
			});
		}
	},
	emailVerification: {
		sendOnSignUp: true,
		sendVerificationEmail: async ({ user, url, token }) => {
			// Better Auth generates verification URLs like: /api/auth/verify-email?token=xxx&callbackURL=yyy
			// When user clicks the link, Better Auth handles verification internally
			const transport = createTransport(env.EMAIL_SERVER);
			const host = new URL(url).host;

			await transport.sendMail({
				from: env.EMAIL_FROM,
				html: createEmailHtml({
					cta: 'Verify email',
					footer: 'If you did not request this email you can safely ignore it.',
					heading: `Verify your email for <strong>${host.replace(/\./g, '&#8203;.')}</strong>`,
					host,
					url
				}),
				subject: `Verify your email — ${host}`,
				text: `Verify your email — ${host}\n${url}\n\n`,
				to: user.email
			});
		}
	},
	plugins: [
		twoFactor({
			issuer: env.APP_NAME
			// Recovery codes are generated automatically
		})
	],
	session: {
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
	trustedOrigins: [env.NEXT_PUBLIC_SITE_URL, 'https://invest-igator.karaliolios.dev']
});

export type Session = typeof auth.$Infer.Session.session;
export type User = typeof auth.$Infer.Session.user;

/**
 * Helper function to create consistent email HTML for Better Auth emails
 */
function createEmailHtml(params: {
	url: string;
	host: string;
	heading: string;
	cta: string;
	footer: string;
	brandColor?: string;
	buttonText?: string;
}) {
	const { url, heading, cta, footer, brandColor = '#f97316', buttonText = '#fff' } = params;

	const color = {
		background: '#f9f9f9',
		buttonBackground: brandColor,
		buttonBorder: brandColor,
		buttonText: buttonText,
		mainBackground: '#fff',
		text: '#444'
	};

	return `
<body style="background: ${color.background};">
	<table width="100%" border="0" cellspacing="20" cellpadding="0"
    style="background: ${color.mainBackground}; max-width: 600px; margin: auto; border-radius: 10px;">
    <tr>
      <td align="center"
        style="padding: 10px 0px; font-size: 22px; font-family: Helvetica, Arial, sans-serif; color: ${color.text};">
				${heading}
      </td>
    </tr>
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td align="center" style="border-radius: 5px;" bgcolor="${color.buttonBackground}"><a href="${url}"
                target="_blank"
								style="font-size: 18px; font-family: Helvetica, Arial, sans-serif; color: ${color.buttonText}; text-decoration: none; border-radius: 5px; padding: 10px 20px; border: 1px solid ${color.buttonBorder}; display: inline-block; font-weight: bold;">${cta}
								</a></td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td align="center"
        style="padding: 0px 0px 10px 0px; font-size: 16px; line-height: 22px; font-family: Helvetica, Arial, sans-serif; color: ${color.text};">
				${footer}
      </td>
    </tr>
  </table>
</body>
`;
}

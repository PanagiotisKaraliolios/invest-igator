import { createTransport } from 'nodemailer';
import { env } from '@/env';

interface EmailOptions {
	to: string;
	subject: string;
	text: string;
	html: string;
}

/**
 * Send an email using nodemailer with configured SMTP server.
 *
 * @param options - Email options (to, subject, text, html)
 * @throws Error if email fails to send
 */
export async function sendEmail(options: EmailOptions): Promise<void> {
	const transport = createTransport(env.EMAIL_SERVER);

	const result = await transport.sendMail({
		from: env.EMAIL_FROM,
		html: options.html,
		subject: options.subject,
		text: options.text,
		to: options.to
	});

	const failed = result.rejected.concat(result.pending).filter(Boolean);
	if (failed.length) {
		throw new Error(`Email(s) (${failed.join(', ')}) could not be sent`);
	}
}

interface EmailTemplateParams {
	url: string;
	host: string;
	heading: string;
	cta: string;
	footer: string;
	brandColor?: string;
	buttonText?: string;
}

/**
 * Create consistent HTML email template for transactional emails.
 * Used for email verification, password reset, email change confirmation, etc.
 */
export function createEmailHtml(params: EmailTemplateParams): string {
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

/**
 * Send a verification email (for email verification or email change confirmation).
 *
 * @param to - Recipient email address
 * @param url - Verification link URL
 * @param mode - Type of verification ('email-change', 'verify-email', or 'auth-email')
 */
export async function sendVerificationEmail(
	to: string,
	url: string,
	mode: 'email-change' | 'verify-email' | 'auth-email' = 'verify-email'
): Promise<void> {
	const host = new URL(url).host;
	const escapedHost = host.replace(/\./g, '&#8203;.');

	const heading =
		mode === 'email-change'
			? `Confirm your new email for <strong>${escapedHost}</strong>`
			: mode === 'verify-email'
				? `Verify your email for <strong>${escapedHost}</strong>`
				: `Access your account at <strong>${escapedHost}</strong>`;

	const cta = mode === 'email-change' ? 'Confirm email' : mode === 'verify-email' ? 'Verify email' : 'Continue';

	const footer =
		mode === 'email-change'
			? 'If you did not request to change your email, you can safely ignore this message.'
			: 'If you did not request this email you can safely ignore it.';

	const subject =
		mode === 'email-change'
			? `Confirm your new email — ${host}`
			: mode === 'verify-email'
				? `Verify your email — ${host}`
				: `Access your account — ${host}`;

	await sendEmail({
		html: createEmailHtml({ cta, footer, heading, host, url }),
		subject,
		text: `${mode === 'email-change' ? 'Confirm your new email' : mode === 'verify-email' ? 'Verify your email' : 'Access your account'} — ${host}\n${url}\n\n`,
		to
	});
}

/**
 * Send a password reset email.
 *
 * @param to - Recipient email address
 * @param url - Password reset link URL
 */
export async function sendPasswordResetEmail(to: string, url: string): Promise<void> {
	const host = new URL(url).host;
	const escapedHost = host.replace(/\./g, '&#8203;.');

	await sendEmail({
		html: createEmailHtml({
			cta: 'Reset password',
			footer: 'If you did not request a password reset, you can safely ignore this email.',
			heading: `Reset your password for <strong>${escapedHost}</strong>`,
			host,
			url
		}),
		subject: `Reset your password — ${host}`,
		text: `Reset your password — ${host}\n${url}\n\n`,
		to
	});
}

/**
 * Send a magic link email for passwordless authentication.
 *
 * @param to - Recipient email address
 * @param url - Magic link URL
 */
export async function sendMagicLinkEmail(to: string, url: string): Promise<void> {
	const host = new URL(url).host;
	const escapedHost = host.replace(/\./g, '&#8203;.');

	await sendEmail({
		html: createEmailHtml({
			cta: 'Sign in',
			footer: 'If you did not request this email you can safely ignore it.',
			heading: `Sign in to <strong>${escapedHost}</strong>`,
			host,
			url
		}),
		subject: `Sign in to ${host}`,
		text: `Sign in to ${host}\n${url}\n\n`,
		to
	});
}

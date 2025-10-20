import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';

/**
 * Legacy email verification endpoint
 *
 * NOTE: This endpoint exists for backward compatibility with old verification tokens.
 * New email verifications should use Better Auth's native /api/auth/verify-email endpoint.
 *
 * Better Auth handles verification through:
 * - Client: sendVerificationEmail({ email, callbackURL })
 * - Better Auth processes at /api/auth/verify-email
 *
 * This route can be removed once all old tokens have expired.
 */
export async function GET(req: Request) {
	const url = new URL(req.url);
	const token = url.searchParams.get('token');
	const parse = z.string().min(10).safeParse(token);
	if (!parse.success) {
		return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
	}

	try {
		const rec = await db.verificationToken.findUnique({ where: { token: parse.data } });
		if (!rec) throw new Error('Invalid or expired token');
		if (rec.expires < new Date()) {
			await db.verificationToken.delete({ where: { token: parse.data } });
			throw new Error('Token expired');
		}

		await db.$transaction([
			db.user.update({
				data: { emailVerified: true, emailVerifiedAt: new Date() },
				where: { email: rec.identifier }
			}),
			db.verificationToken.delete({ where: { token: parse.data } })
		]);

		return NextResponse.redirect(new URL('/verify-email/confirmed', url));
	} catch (e: any) {
		const reason = encodeURIComponent(e?.message || 'Failed to verify email');
		return NextResponse.redirect(new URL(`/verify-email/error?reason=${reason}`, url));
	}
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createCaller } from '@/server/api/root';
import { createTRPCContext } from '@/server/api/trpc';

export async function GET(req: Request) {
	const url = new URL(req.url);
	const token = url.searchParams.get('token');
	const parse = z.string().min(10).safeParse(token);
	if (!parse.success) {
		return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
	}

	const ctx = await createTRPCContext({ headers: new Headers(req.headers) });
	const caller = createCaller(() => Promise.resolve(ctx));

	try {
		await caller.account.confirmEmailChange({ token: parse.data });
		// Redirect to a friendly confirmation page
		return NextResponse.redirect(new URL('/email-change/confirmed', url));
	} catch (e: any) {
		const reason = encodeURIComponent(e?.message || 'Failed to confirm email');
		return NextResponse.redirect(new URL(`/email-change/error?reason=${reason}`, url));
	}
}

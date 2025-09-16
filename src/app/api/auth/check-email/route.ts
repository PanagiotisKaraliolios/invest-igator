import { NextResponse } from 'next/server';
import { db } from '@/server/db';

export async function GET(req: Request) {
	try {
		const { searchParams } = new URL(req.url);
		const email = searchParams.get('email');
		if (!email) {
			return NextResponse.json({ error: 'Missing email' }, { status: 400 });
		}

		const user = await db.user.findUnique({ where: { email } });
		return NextResponse.json({ exists: Boolean(user) });
	} catch (err) {
		return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 });
	}
}

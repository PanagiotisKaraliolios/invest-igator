import * as bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { env } from '@/env';
import { db } from '@/server/db';

export async function POST(req: Request) {
	try {
		const body = await req.json();
		const name = typeof body?.name === 'string' ? body.name.trim() : '';
		const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
		const password = typeof body?.password === 'string' ? body.password : '';
		if (!name || !email || !password) {
			return NextResponse.json({ error: 'Missing name, email or password' }, { status: 400 });
		}

		const existing = await db.user.findUnique({ where: { email } });
		if (existing) {
			return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 });
		}

		const pepper = env.PASSWORD_PEPPER ?? '';
		const passwordHash = await bcrypt.hash(`${password}${pepper}`, 12);
		await db.user.create({ data: { email, name, passwordHash } });
		return NextResponse.json({ ok: true });
	} catch (err) {
		return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 });
	}
}

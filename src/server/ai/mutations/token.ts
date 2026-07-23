import { createHmac, timingSafeEqual } from 'node:crypto';

/** The signed, tamper-evident, time-bounded envelope a mutating tool returns for a human to confirm. */
export type MutationPayload = {
	v: 1;
	userId: string;
	tool: string;
	args: unknown;
	jti: string;
	iat: number;
	exp: number;
};

function sign(encodedPayload: string, secret: string): string {
	return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

/** `base64url(json).base64url(hmac)`. */
export function signMutation(payload: MutationPayload, secret: string): string {
	const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
	return `${encoded}.${sign(encoded, secret)}`;
}

function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

/**
 * Verify signature FIRST (constant-time), THEN expiry — so a forged token never reports EXPIRED
 * (which would leak that the signature check was skipped). `now` is injectable for tests; callers
 * pass `Date.now() / 1000` (seconds) in production.
 */
export function verifyMutation(
	token: string,
	secret: string,
	now: number = Math.floor(Date.now() / 1000)
): { ok: true; payload: MutationPayload } | { ok: false; reason: 'INVALID' | 'EXPIRED' } {
	const dot = token.indexOf('.');
	if (dot <= 0) return { ok: false, reason: 'INVALID' };
	const encoded = token.slice(0, dot);
	const sig = token.slice(dot + 1);
	if (!safeEqual(sig, sign(encoded, secret))) return { ok: false, reason: 'INVALID' };

	let payload: MutationPayload;
	try {
		payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as MutationPayload;
	} catch {
		return { ok: false, reason: 'INVALID' };
	}
	if (payload.v !== 1 || typeof payload.exp !== 'number') return { ok: false, reason: 'INVALID' };
	if (now > payload.exp) return { ok: false, reason: 'EXPIRED' };
	return { ok: true, payload };
}

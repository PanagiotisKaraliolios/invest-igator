import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { authenticator } from 'otplib';
import { env } from '@/env';

const ISSUER = env.APP_NAME || 'Invest-igator';
const RECOVERY_CODE_COUNT = 10;
const BCRYPT_ROUNDS = 12;

authenticator.options = { window: 1 };

export function generateTwoFactorSecret(label?: string) {
	const accountName = label || 'user';
	const secret = authenticator.generateSecret();
	const otpauthUrl = authenticator.keyuri(accountName, ISSUER, secret);
	return { otpauthUrl, secret };
}

export function normalizeOtpToken(input: string) {
	return input.replace(/\s+/g, '');
}

export function normalizeRecoveryCode(input: string) {
	const cleaned = input.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
	if (cleaned.length < 10) return null;
	const segmentA = cleaned.slice(0, 5);
	const segmentB = cleaned.slice(5, 10);
	return `${segmentA}-${segmentB}`;
}

export function verifyTotpToken(secret: string, token: string) {
	const numeric = token.replace(/[^0-9]/g, '');
	if (numeric.length < 6) return false;
	return authenticator.check(numeric, secret);
}

export async function createRecoveryCodes(count = RECOVERY_CODE_COUNT) {
	const codes: string[] = [];
	for (let i = 0; i < count; i += 1) {
		const raw = randomBytes(5).toString('hex').toUpperCase();
		codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
	}
	const hashed = await Promise.all(codes.map((code) => bcrypt.hash(code, BCRYPT_ROUNDS)));
	return { hashed, plain: codes };
}

export async function findMatchingRecoveryCode(
	input: string,
	hashedCodes: string[]
): Promise<{ matchedHash: string | null; normalized: string | null }> {
	const normalized = normalizeRecoveryCode(input);
	if (!normalized) return { matchedHash: null, normalized: null };
	for (const hashed of hashedCodes) {
		const ok = await bcrypt.compare(normalized, hashed);
		if (ok) {
			return { matchedHash: hashed, normalized };
		}
	}
	return { matchedHash: null, normalized };
}

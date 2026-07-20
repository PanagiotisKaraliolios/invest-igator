// Deliberately NO `import 'server-only'`: Ofelia runs cron jobs as `bun run
// src/server/jobs/*.ts`, and the server-only marker throws outside a bundler that
// resolves its `react-server` condition. Adding it crashes every cron that
// transitively imports this module. Client-import safety already comes from the
// `node:crypto` import (unresolvable in a browser bundle) and from Next inlining
// only NEXT_PUBLIC_* env vars. See revert 543523c.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { inspect } from 'node:util';

const REDACTED = '[redacted]';

export class Secret {
	readonly #value: string;

	constructor(v: string) {
		this.#value = v;
	}

	expose(): string {
		return this.#value;
	}

	toString(): string {
		return REDACTED;
	}

	toJSON(): string {
		return REDACTED;
	}

	[inspect.custom](): string {
		return REDACTED;
	}
}

export type SealedBlob = {
	kid: string;
	iv: Uint8Array;
	ciphertext: Uint8Array;
	authTag: Uint8Array;
};

type Keyring = { activeKid: string; keys: Map<string, Buffer> };

/**
 * Cached on the raw env strings, so rotating the env (tests, a redeploy that
 * re-execs the process) rebuilds the ring instead of serving a stale one.
 */
let cached: { rawKeys: string; rawActive: string; ring: Keyring } | null = null;

/**
 * Binds the ciphertext to (userId, provider). A row copied to another tenant
 * FAILS to decrypt rather than silently working. Never change this format
 * without bumping the `v1` suffix and re-sealing every row.
 *
 * The `|` delimiter is not escaped, so both fields must be validated as
 * delimiter-free (and non-empty) for the encoding to stay injective — two
 * different (userId, provider) pairs must never serialize to the same AAD.
 * Shared by seal() and open() so neither can skip the check.
 */
const aad = (userId: string, provider: string): Buffer => {
	if (!userId) throw new Error('ai/crypto: userId must not be empty');
	if (!provider) throw new Error('ai/crypto: provider must not be empty');
	if (userId.includes('|')) throw new Error('ai/crypto: userId must not contain the "|" delimiter');
	if (provider.includes('|')) throw new Error('ai/crypto: provider must not contain the "|" delimiter');
	return Buffer.from(`${userId}|${provider}|v1`, 'utf8');
};

/** Lazy: a module-eval throw would break `next build` when the env var is absent. */
function keyring(): Keyring {
	const rawKeys = process.env.AI_CRED_KEYS;
	const rawActive = process.env.AI_CRED_ACTIVE_KID;
	if (!rawKeys) throw new Error('ai/crypto: AI_CRED_KEYS is not set');
	if (!rawActive) throw new Error('ai/crypto: AI_CRED_ACTIVE_KID is not set');
	if (cached && cached.rawKeys === rawKeys && cached.rawActive === rawActive) return cached.ring;

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawKeys);
	} catch {
		throw new Error('ai/crypto: AI_CRED_KEYS is not valid JSON');
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error('ai/crypto: AI_CRED_KEYS must be a JSON object of { kid: base64Key }');
	}

	const keys = new Map<string, Buffer>();
	for (const [kid, value] of Object.entries(parsed as Record<string, unknown>)) {
		if (typeof value !== 'string') {
			throw new Error(`ai/crypto: key "${kid}" in AI_CRED_KEYS is not a string`);
		}
		const key = Buffer.from(value, 'base64');
		if (key.byteLength !== 32) {
			throw new Error(
				`ai/crypto: key "${kid}" must be 32 bytes (got ${key.byteLength}) — AES-256-GCM requires a 256-bit key`
			);
		}
		keys.set(kid, key);
	}
	if (!keys.has(rawActive)) {
		throw new Error(`ai/crypto: AI_CRED_ACTIVE_KID "${rawActive}" is not present in AI_CRED_KEYS`);
	}

	const ring: Keyring = { activeKid: rawActive, keys };
	cached = { rawActive, rawKeys, ring };
	return ring;
}

export function seal(plaintext: string, userId: string, provider: string): SealedBlob {
	if (!plaintext) throw new Error('ai/crypto: plaintext must not be empty');
	const ring = keyring();
	const key = ring.keys.get(ring.activeKid);
	if (!key) throw new Error(`ai/crypto: active kid "${ring.activeKid}" missing from keyring`);

	// Fresh nonce EVERY call. Never derived, never a counter: GCM nonce reuse
	// under one key leaks plaintext XOR and enables forgery.
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	cipher.setAAD(aad(userId, provider));
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	return { authTag: cipher.getAuthTag(), ciphertext, iv, kid: ring.activeKid };
}

export function open(blob: SealedBlob, userId: string, provider: string): Secret {
	const ring = keyring();
	const key = ring.keys.get(blob.kid);
	if (!key) {
		throw new Error(`ai/crypto: unknown kid "${blob.kid}" — not in AI_CRED_KEYS. Refusing to guess a key.`);
	}
	if (blob.iv.byteLength !== 12) {
		throw new Error(`ai/crypto: iv must be 12 bytes (got ${blob.iv.byteLength})`);
	}
	if (blob.authTag.byteLength !== 16) {
		throw new Error(`ai/crypto: authTag must be 16 bytes (got ${blob.authTag.byteLength})`);
	}

	const decipher = createDecipheriv('aes-256-gcm', key, blob.iv);
	decipher.setAAD(aad(userId, provider));
	decipher.setAuthTag(blob.authTag); // MUST precede final()
	const plaintext = Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]);
	return new Secret(plaintext.toString('utf8'));
}

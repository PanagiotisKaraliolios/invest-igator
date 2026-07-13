import { beforeEach, describe, expect, test } from 'bun:test';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { open, Secret, seal } from './crypto';

const KEY_1 = Buffer.alloc(32, 0x11).toString('base64');
const KEY_2 = Buffer.alloc(32, 0x22).toString('base64');

function setKeyring(keys: Record<string, string>, activeKid: string): void {
	process.env.AI_CRED_KEYS = JSON.stringify(keys);
	process.env.AI_CRED_ACTIVE_KID = activeKid;
}

beforeEach(() => {
	setKeyring({ k1: KEY_1 }, 'k1');
});

describe('Bun node:crypto AES-256-GCM smoke test', () => {
	test('setAAD is enforced and getAuthTag returns 16 bytes', () => {
		const key = randomBytes(32);
		const iv = randomBytes(12);
		const cipher = createCipheriv('aes-256-gcm', key, iv);
		cipher.setAAD(Buffer.from('user-a|AZURE|v1', 'utf8'));
		const ct = Buffer.concat([cipher.update('sk-secret', 'utf8'), cipher.final()]);
		const tag = cipher.getAuthTag();
		expect(tag.byteLength).toBe(16);

		const good = createDecipheriv('aes-256-gcm', key, iv);
		good.setAAD(Buffer.from('user-a|AZURE|v1', 'utf8'));
		good.setAuthTag(tag);
		expect(Buffer.concat([good.update(ct), good.final()]).toString('utf8')).toBe('sk-secret');

		const bad = createDecipheriv('aes-256-gcm', key, iv);
		bad.setAAD(Buffer.from('user-b|AZURE|v1', 'utf8'));
		bad.setAuthTag(tag);
		expect(() => Buffer.concat([bad.update(ct), bad.final()])).toThrow();
	});
});

describe('seal/open', () => {
	test('round-trips a secret', () => {
		const blob = seal('sk-abc-123', 'user-a', 'AZURE');
		expect(blob.kid).toBe('k1');
		expect(blob.iv.byteLength).toBe(12);
		expect(blob.authTag.byteLength).toBe(16);
		expect(blob.ciphertext.toString('utf8')).not.toContain('sk-abc-123');
		expect(open(blob, 'user-a', 'AZURE').expose()).toBe('sk-abc-123');
	});

	test('uses a fresh random iv per call', () => {
		const a = seal('same-plaintext', 'user-a', 'AZURE');
		const b = seal('same-plaintext', 'user-a', 'AZURE');
		expect(a.iv.equals(b.iv)).toBe(false);
		expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
		expect(open(a, 'user-a', 'AZURE').expose()).toBe('same-plaintext');
		expect(open(b, 'user-a', 'AZURE').expose()).toBe('same-plaintext');
	});

	test('open throws when the authTag is wrong', () => {
		const blob = seal('sk-abc-123', 'user-a', 'AZURE');
		const tampered = Buffer.from(blob.authTag);
		tampered[0] = (tampered[0] ?? 0) ^ 0xff;
		expect(() => open({ ...blob, authTag: tampered }, 'user-a', 'AZURE')).toThrow();
	});

	test('open throws when the authTag is missing', () => {
		const blob = seal('sk-abc-123', 'user-a', 'AZURE');
		expect(() => open({ ...blob, authTag: Buffer.alloc(0) }, 'user-a', 'AZURE')).toThrow(
			/authTag must be 16 bytes/
		);
	});

	test('open throws when the iv is the wrong length', () => {
		const blob = seal('sk-abc-123', 'user-a', 'AZURE');
		expect(() => open({ ...blob, iv: Buffer.alloc(16, 0x00) }, 'user-a', 'AZURE')).toThrow(/iv must be 12 bytes/);
	});

	test('open throws when the ciphertext is tampered with', () => {
		const blob = seal('sk-abc-123', 'user-a', 'AZURE');
		const ct = Buffer.from(blob.ciphertext);
		ct[0] = (ct[0] ?? 0) ^ 0xff;
		expect(() => open({ ...blob, ciphertext: ct }, 'user-a', 'AZURE')).toThrow();
	});

	// Prisma 7 hydrates Bytes as Uint8Array, NOT Buffer. This is the exact shape
	// Task 6 will hand back to open(). Pin it here so Task 6 cannot get it wrong.
	test('accepts a blob rebuilt from Uint8Array (the Prisma Bytes shape)', () => {
		const blob = seal('sk-abc-123', 'user-a', 'AZURE');
		const asRow = {
			authTag: new Uint8Array(blob.authTag),
			ciphertext: new Uint8Array(blob.ciphertext),
			iv: new Uint8Array(blob.iv),
			kid: blob.kid
		};
		const rehydrated = {
			authTag: Buffer.from(asRow.authTag),
			ciphertext: Buffer.from(asRow.ciphertext),
			iv: Buffer.from(asRow.iv),
			kid: asRow.kid
		};
		expect(open(rehydrated, 'user-a', 'AZURE').expose()).toBe('sk-abc-123');
	});
});

describe('AAD tenant binding', () => {
	test("user A's blob does not decrypt as user B", () => {
		const blob = seal('sk-abc-123', 'user-a', 'AZURE');
		expect(() => open(blob, 'user-b', 'AZURE')).toThrow();
	});

	test('a blob sealed for one provider does not decrypt as another', () => {
		const blob = seal('sk-abc-123', 'user-a', 'AZURE');
		expect(() => open(blob, 'user-a', 'OPENAI')).toThrow();
	});
});

describe('keyring', () => {
	test('a retired key still decrypts after the active kid rotates', () => {
		const blob = seal('sk-old', 'user-a', 'AZURE');
		expect(blob.kid).toBe('k1');
		setKeyring({ k1: KEY_1, k2: KEY_2 }, 'k2');
		expect(seal('sk-new', 'user-a', 'AZURE').kid).toBe('k2');
		expect(open(blob, 'user-a', 'AZURE').expose()).toBe('sk-old');
	});

	test('an unknown kid throws loudly instead of guessing', () => {
		const blob = seal('sk-abc-123', 'user-a', 'AZURE');
		setKeyring({ k2: KEY_2 }, 'k2');
		expect(() => open(blob, 'user-a', 'AZURE')).toThrow(/unknown kid "k1"/);
	});

	test('rejects a key that is not 32 bytes', () => {
		setKeyring({ k1: Buffer.alloc(16, 0x11).toString('base64') }, 'k1');
		expect(() => seal('sk-abc-123', 'user-a', 'AZURE')).toThrow(/must be 32 bytes/);
	});

	test('rejects an active kid missing from the keyring', () => {
		setKeyring({ k1: KEY_1 }, 'k9');
		expect(() => seal('sk-abc-123', 'user-a', 'AZURE')).toThrow(/"k9" is not present/);
	});

	test('loads lazily: the env is read at call time, not at module eval', () => {
		delete process.env.AI_CRED_KEYS;
		delete process.env.AI_CRED_ACTIVE_KID;
		expect(() => seal('sk-abc-123', 'user-a', 'AZURE')).toThrow(/AI_CRED_KEYS is not set/);
	});
});

describe('Secret', () => {
	test('expose returns the plaintext', () => {
		expect(new Secret('sk-123').expose()).toBe('sk-123');
	});

	test('toString, toJSON and util.inspect all redact', () => {
		const s = new Secret('sk-123');
		expect(s.toString()).toBe('[redacted]');
		expect(s.toJSON()).toBe('[redacted]');
		expect(inspect(s)).toBe('[redacted]');
		expect(`${s}`).toBe('[redacted]');
	});

	test('JSON.stringify never emits the plaintext', () => {
		expect(JSON.stringify(new Secret('sk-123'))).toBe('"[redacted]"');
		const body = JSON.stringify({ apiKey: new Secret('sk-123'), user: 'a' });
		expect(body).not.toContain('sk-123');
		expect(inspect({ apiKey: new Secret('sk-123') })).not.toContain('sk-123');
	});
});

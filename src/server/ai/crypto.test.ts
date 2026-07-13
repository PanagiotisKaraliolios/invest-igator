import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { open, type SealedBlob, Secret, seal } from './crypto';

const KEY_1 = Buffer.alloc(32, 0x11).toString('base64');
const KEY_2 = Buffer.alloc(32, 0x22).toString('base64');

function setKeyring(keys: Record<string, string>, activeKid: string): void {
	process.env.AI_CRED_KEYS = JSON.stringify(keys);
	process.env.AI_CRED_ACTIVE_KID = activeKid;
}

beforeEach(() => {
	setKeyring({ k1: KEY_1 }, 'k1');
});

// One test (`loads lazily`) deletes AI_CRED_* from process.env and never restored
// it, leaving the shared Bun test process's env mutated for whatever file runs
// next. beforeEach re-seeds it for tests in *this* file, but afterEach closes the
// hole for every other file sharing the process.
afterEach(() => {
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

	// Prisma 7 hydrates Bytes columns as raw Uint8Array, NOT Buffer — Task 6 will
	// hand open() exactly this shape when reading a row back out of Postgres.
	// SealedBlob's fields are typed Uint8Array (Buffer extends Uint8Array, so
	// seal()'s Buffer output is still assignable), so this is a real SealedBlob
	// with no cast — it proves the Prisma Bytes → open() handoff at the type
	// level, not just at runtime.
	test('accepts a blob whose fields are raw Uint8Array (the Prisma Bytes shape)', () => {
		const blob = seal('sk-abc-123', 'user-a', 'AZURE');
		const asRow: SealedBlob = {
			authTag: new Uint8Array(blob.authTag),
			ciphertext: new Uint8Array(blob.ciphertext),
			iv: new Uint8Array(blob.iv),
			kid: blob.kid
		};
		expect(open(asRow, 'user-a', 'AZURE').expose()).toBe('sk-abc-123');
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

describe('AAD encoding is injective', () => {
	// The AAD is `${userId}|${provider}|v1` and does not escape its own `|`
	// delimiter. Without validation, two different (userId, provider) pairs can
	// serialize to the identical AAD string, defeating the tenant binding these
	// fields exist to provide. Rejecting `|` and empty strings in both fields
	// makes the encoding unambiguous without changing the `v1` format string
	// (so no version bump / re-seal is required).

	test('seal throws when userId contains the delimiter', () => {
		expect(() => seal('sk-abc-123', 'alice|AZURE', 'AZURE')).toThrow(/delimiter/);
	});

	test('seal throws when provider contains the delimiter', () => {
		expect(() => seal('sk-abc-123', 'alice', 'AZURE|')).toThrow(/delimiter/);
	});

	test('seal throws when userId is empty', () => {
		expect(() => seal('sk-abc-123', '', 'AZURE')).toThrow(/userId must not be empty/);
	});

	test('seal throws when provider is empty', () => {
		expect(() => seal('sk-abc-123', 'alice', '')).toThrow(/provider must not be empty/);
	});

	test('open throws when userId contains the delimiter', () => {
		const blob = seal('sk-abc-123', 'alice', 'AZURE');
		expect(() => open(blob, 'alice|AZURE', 'AZURE')).toThrow(/delimiter/);
	});

	test('open throws when provider contains the delimiter', () => {
		const blob = seal('sk-abc-123', 'alice', 'AZURE');
		expect(() => open(blob, 'alice', 'AZURE|')).toThrow(/delimiter/);
	});

	test('open throws when userId or provider is empty', () => {
		const blob = seal('sk-abc-123', 'alice', 'AZURE');
		expect(() => open(blob, '', 'AZURE')).toThrow(/userId must not be empty/);
		expect(() => open(blob, 'alice', '')).toThrow(/provider must not be empty/);
	});

	test('seal throws on empty plaintext', () => {
		expect(() => seal('', 'alice', 'AZURE')).toThrow(/plaintext must not be empty/);
	});

	// The reviewer's exact collision PoC: sealing ('alice|AZURE', '') and opening
	// with ('alice', 'AZURE|') both used to serialize to AAD "alice|AZURE||v1".
	// Neither the seal side nor the open side of the collision may succeed.
	test('the reviewer-reported collision is now impossible', () => {
		// seal() side: 'alice|AZURE' + '' both used to combine into the same AAD
		// as 'alice' + 'AZURE|'. Either malformed field alone is now rejected, so
		// the victim blob the PoC depends on can never be produced.
		expect(() => seal('sk-victim', 'alice|AZURE', '')).toThrow();
		// open() side: even against an unrelated, validly-sealed blob, the
		// colliding ('alice', 'AZURE|') pair is independently rejected too.
		const blob = seal('sk-abc-123', 'alice', 'AZURE');
		expect(() => open(blob, 'alice', 'AZURE|')).toThrow(/delimiter/);
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

	// The redacting methods (toString/toJSON/inspect.custom) only protect call
	// sites that go through them. `#value` being a true private class field —
	// NOT a TS `private value` field, which is still a plain enumerable own
	// property at runtime — is what protects every other route: Object.values,
	// Object.entries, spread, Object.assign, structuredClone, and `for...in`
	// (the shape Sentry-style scrubbers walk). Pin that property directly so a
	// well-meaning "idiomatic" refactor from `#value` to `private value` gets
	// caught here instead of shipping a silent leak.
	test('the plaintext is not an own enumerable property', () => {
		const s = new Secret('sk-123');

		expect(Object.getOwnPropertyNames(s)).toEqual([]);
		expect(Object.keys(s)).toEqual([]);
		expect(Object.values(s)).toEqual([]);
		expect(Object.entries(s)).toEqual([]);
		expect({ ...s }).toEqual({});
		expect(Object.assign({}, s)).toEqual({});

		const cloned = structuredClone(s);
		expect(JSON.stringify(cloned)).not.toContain('sk-123');
		expect(Object.keys(cloned as unknown as Record<string, unknown>)).toEqual([]);

		const seen: string[] = [];
		for (const key in s) {
			seen.push(key);
		}
		expect(seen).toEqual([]);
	});
});

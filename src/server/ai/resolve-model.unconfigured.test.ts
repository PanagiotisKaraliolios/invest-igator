import { beforeEach, describe, expect, mock, test } from 'bun:test';

/**
 * The user's actual situation: NO Azure credentials at all, but they've added their own BYOK
 * provider credential. `resolveModel(userId)` must still return a working model — the
 * platform being entirely unconfigured must never block a BYOK user. This is a separate file
 * (not a describe block in resolve-model.test.ts) because '@/env' must be mocked BEFORE the
 * first import, and resolve-model.test.ts already mocks it fully configured.
 */
mock.module('@/env', () => ({
	env: {
		AZURE_OPENAI_API_KEY: undefined,
		AZURE_OPENAI_CHAT_DEPLOYMENT: undefined,
		AZURE_OPENAI_CHAT_MODEL: 'gpt-5.4-mini',
		AZURE_OPENAI_RESOURCE_NAME: undefined
	}
}));

type Row = {
	apiVersion: string | null;
	authTag: Uint8Array;
	baseURL: string | null;
	ciphertext: Uint8Array;
	defaultModelId: string;
	deployment: string | null;
	enabled: boolean;
	iv: Uint8Array;
	kid: string;
	provider: string;
	resourceName: string | null;
	userId: string;
};

let credential: Row | null = null;

mock.module('@/server/db', () => ({
	db: {
		aiProviderCredential: {
			findFirst: async () => credential
		}
	}
}));

// Surgical: spread the REAL module's exports rather than replacing the whole thing. A blanket
// `mock.module('@/server/ai/crypto', () => ({ open }))` drops `Secret`/`seal`, which broke
// crypto.test.ts when both files ran in the same bun process without `--isolate`.
const actualCrypto = await import('@/server/ai/crypto');
mock.module('@/server/ai/crypto', () => ({
	...actualCrypto,
	open: () => ({ expose: () => 'sk-byok-plaintext' })
}));

const { resolveModel } = await import('./resolve-model');

const bytes = () => new Uint8Array([1, 2, 3]);

// A non-Azure BYOK provider: proves a BYOK user's model has nothing to do with the platform's
// Azure config — the two are entirely independent code paths.
const ROW: Row = {
	apiVersion: null,
	authTag: bytes(),
	baseURL: null,
	ciphertext: bytes(),
	defaultModelId: 'claude-haiku-4-5',
	deployment: null,
	enabled: true,
	iv: bytes(),
	kid: 'k1',
	provider: 'ANTHROPIC',
	resourceName: null,
	userId: 'user-1'
};

beforeEach(() => {
	credential = null;
});

describe('resolveModel — platform entirely unconfigured', () => {
	// This is the regression this whole fix wave exists to close: Task 6 required the Azure
	// env vars, so an app with zero Azure credentials refused to boot at all — a BYOK user
	// never even got the chance to reach this code path.
	test('a BYOK user still gets a working model', async () => {
		credential = { ...ROW };
		const resolved = await resolveModel('user-1');
		expect(resolved.byok).toBe(true);
		expect(resolved.providerId).toBe('anthropic');
		expect(resolved.resolvedModel).toBe('claude-haiku-4-5');
	});

	// The flip side, proven for completeness: with no BYOK credential AND no platform
	// configured, there is genuinely no model to resolve — resolveModel surfaces
	// platformModel()'s actionable error rather than returning something broken.
	test('no credential and no platform -> the actionable "no platform LLM" error', async () => {
		credential = null;
		await expect(resolveModel('user-1')).rejects.toThrow('No platform LLM configured');
	});
});

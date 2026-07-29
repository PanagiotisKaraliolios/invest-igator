import { beforeEach, describe, expect, mock, test } from 'bun:test';

type Row = {
	apiVersion: string | null;
	authTag: Uint8Array;
	baseURL: string | null;
	ciphertext: Uint8Array;
	defaultModelId: string;
	deployment: string | null;
	enabled: boolean;
	enabledModelIds: string[];
	iv: Uint8Array;
	kid: string;
	provider: string;
	resourceName: string | null;
	userId: string;
};

let credential: Row | null = null;

mock.module('@/env', () => ({
	env: {
		AZURE_OPENAI_API_KEY: 'test-key',
		AZURE_OPENAI_CHAT_DEPLOYMENT: 'platform-deployment',
		AZURE_OPENAI_CHAT_MODEL: 'gpt-5.4-mini',
		AZURE_OPENAI_RESOURCE_NAME: 'acme'
	}
}));

mock.module('@/server/db', () => ({
	db: {
		aiProviderCredential: {
			findFirst: async () => credential
		}
	}
}));

// Surgical: spread the REAL module's exports rather than replacing the whole thing — see
// resolve-model.test.ts for why a blanket replacement breaks crypto.test.ts.
const actualCrypto = await import('@/server/ai/crypto');
mock.module('@/server/ai/crypto', () => ({
	...actualCrypto,
	open: () => ({ expose: () => 'sk-byok-plaintext' })
}));

const { resolveModel } = await import('./resolve-model');

const bytes = () => new Uint8Array([1, 2, 3]);

const ANTHROPIC_ROW: Row = {
	apiVersion: null,
	authTag: bytes(),
	baseURL: null,
	ciphertext: bytes(),
	defaultModelId: 'claude-opus-5',
	deployment: null,
	enabled: true,
	enabledModelIds: ['claude-opus-5', 'claude-sonnet-5'],
	iv: bytes(),
	kid: 'k1',
	provider: 'ANTHROPIC',
	resourceName: null,
	userId: 'user-1'
};

const AZURE_ROW: Row = {
	apiVersion: null,
	authTag: bytes(),
	baseURL: null,
	ciphertext: bytes(),
	defaultModelId: 'gpt-5.4-mini',
	deployment: 'my-deployment',
	enabled: true,
	enabledModelIds: ['gpt-5.4-mini', 'gpt-5'],
	iv: bytes(),
	kid: 'k1',
	provider: 'AZURE',
	resourceName: 'acme',
	userId: 'user-1'
};

beforeEach(() => {
	credential = null;
});

describe('resolveModel with a model-level selector', () => {
	test('builds and PRICES the selected model when it is enabled', async () => {
		credential = { ...ANTHROPIC_ROW };
		const resolved = await resolveModel('user-1', {
			kind: 'byok',
			modelId: 'claude-sonnet-5',
			provider: 'ANTHROPIC'
		});
		expect(resolved.modelId).toBe('claude-sonnet-5');
		// resolvedModel is what usage is priced on — it must follow the selection.
		expect(resolved.resolvedModel).toBe('claude-sonnet-5');
	});

	test('falls back to defaultModelId when the requested model is NOT enabled', async () => {
		credential = { ...ANTHROPIC_ROW };
		const resolved = await resolveModel('user-1', {
			kind: 'byok',
			modelId: 'claude-haiku-9',
			provider: 'ANTHROPIC'
		});
		// Never build an un-enabled model.
		expect(resolved.resolvedModel).toBe('claude-opus-5');
	});

	test('omitting modelId keeps the pre-picker behaviour', async () => {
		credential = { ...ANTHROPIC_ROW };
		const resolved = await resolveModel('user-1', { kind: 'byok', provider: 'ANTHROPIC' });
		expect(resolved.resolvedModel).toBe('claude-opus-5');
	});

	test('AZURE ignores a requested modelId (deployment routing would mis-price)', async () => {
		credential = { ...AZURE_ROW };
		const resolved = await resolveModel('user-1', {
			kind: 'byok',
			modelId: 'gpt-5',
			provider: 'AZURE'
		});
		// The call routes on the deployment, so pricing must stay on the default model.
		expect(resolved.modelId).toBe('my-deployment');
		expect(resolved.resolvedModel).toBe('gpt-5.4-mini');
	});
});

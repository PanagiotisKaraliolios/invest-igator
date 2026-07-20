import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { generateText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

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
const findFirstArgs: unknown[] = [];
const openArgs: Array<{ provider: string; userId: string }> = [];

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
			findFirst: async (args: unknown) => {
				findFirstArgs.push(args);
				return credential;
			}
		}
	}
}));

// Surgical: spread the REAL module's exports rather than replacing the whole thing. A
// blanket `mock.module('@/server/ai/crypto', () => ({ open }))` drops `Secret`/`seal`, which
// broke crypto.test.ts when both files ran in the same bun process without `--isolate`.
const actualCrypto = await import('@/server/ai/crypto');
mock.module('@/server/ai/crypto', () => ({
	...actualCrypto,
	open: (_blob: unknown, userId: string, provider: string) => {
		openArgs.push({ provider, userId });
		return { expose: () => 'sk-byok-plaintext' };
	}
}));

/**
 * A spy on the REAL provider factory `resolveModel`/`buildByokModel` actually call — NOT a
 * hand-built registry. Each `azure(modelId)` invocation returns a FRESH MockLanguageModelV4
 * carrying that `modelId`, so the existing "deployment name is the model id" tests keep
 * working, while C1's guardrail-attachment test can grab the freshly created spy and drive it
 * through the real `generateText` to see what actually reached the provider.
 */
const azureModelsCreated: MockLanguageModelV4[] = [];

mock.module('@ai-sdk/azure', () => ({
	createAzure: () => {
		const provider = (modelId: string) => {
			const model = new MockLanguageModelV4({
				doGenerate: {
					content: [{ text: 'ok', type: 'text' }],
					finishReason: { raw: 'stop', unified: 'stop' },
					usage: {
						inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 10, total: 10 },
						outputTokens: { reasoning: 0, text: 5, total: 5 }
					},
					warnings: []
				},
				modelId,
				provider: 'mock-azure'
			});
			azureModelsCreated.push(model);
			return model;
		};
		return Object.assign(provider, { languageModel: provider });
	}
}));

const { buildByokModel, InvalidCredentialError, normaliseAzureBaseUrl, resolveModel } = await import('./resolve-model');
const { MAX_OUTPUT_TOKENS } = await import('./guardrails');

const bytes = () => new Uint8Array([1, 2, 3]);

const ROW: Row = {
	apiVersion: null,
	authTag: bytes(),
	baseURL: null,
	ciphertext: bytes(),
	defaultModelId: 'gpt-5.4-mini',
	deployment: 'user-mini-deployment',
	enabled: true,
	iv: bytes(),
	kid: 'k1',
	provider: 'AZURE',
	resourceName: 'user-resource',
	userId: 'user-1'
};

const AZURE = {
	apiVersion: null,
	baseURL: null,
	defaultModelId: 'gpt-5.4-mini',
	deployment: 'prod-mini',
	provider: 'AZURE',
	resourceName: 'acme'
} as const;

beforeEach(() => {
	credential = null;
	findFirstArgs.length = 0;
	openArgs.length = 0;
	azureModelsCreated.length = 0;
});

describe('normaliseAzureBaseUrl', () => {
	// The SDK appends `/v1{path}` itself. A pasted '.../openai/v1' yields /v1/v1/responses
	// -> 404, which looks exactly like a broken key.
	test('strips a trailing /v1', () => {
		expect(normaliseAzureBaseUrl('https://acme.openai.azure.com/openai/v1')).toBe(
			'https://acme.openai.azure.com/openai'
		);
	});
	test('strips a trailing /v1 with a trailing slash', () => {
		expect(normaliseAzureBaseUrl('https://acme.openai.azure.com/openai/v1/')).toBe(
			'https://acme.openai.azure.com/openai'
		);
	});
	test('leaves a correct endpoint alone', () => {
		expect(normaliseAzureBaseUrl('https://acme.openai.azure.com/openai')).toBe(
			'https://acme.openai.azure.com/openai'
		);
	});
	test('appends /openai to a bare resource URL', () => {
		expect(normaliseAzureBaseUrl('https://acme.openai.azure.com')).toBe('https://acme.openai.azure.com/openai');
		expect(normaliseAzureBaseUrl('https://acme.openai.azure.com/')).toBe('https://acme.openai.azure.com/openai');
	});
	test('drops a pasted api-version query string', () => {
		expect(normaliseAzureBaseUrl('https://acme.openai.azure.com/openai/v1?api-version=2024-02-01')).toBe(
			'https://acme.openai.azure.com/openai'
		);
	});
	test('rejects a non-URL', () => {
		expect(() => normaliseAzureBaseUrl('not a url')).toThrow(InvalidCredentialError);
	});

	// I4: the Azure Portal's "Target URI" field — the most common real-world paste — hands
	// users the FULL deployment URL, not a bare endpoint. Left unchanged, the SDK appends
	// `/v1/responses` to a path that already ends in `/chat/completions` -> 404 that looks
	// exactly like a broken key.
	test('truncates a full deployment URL (Azure Portal "Target URI" paste) at /openai', () => {
		expect(
			normaliseAzureBaseUrl(
				'https://acme.openai.azure.com/openai/deployments/gpt5/chat/completions?api-version=2024-02-01'
			)
		).toBe('https://acme.openai.azure.com/openai');
	});
	test('truncates a deployment URL with no query string too', () => {
		expect(
			normaliseAzureBaseUrl('https://acme.openai.azure.com/openai/deployments/gpt5-mini/chat/completions')
		).toBe('https://acme.openai.azure.com/openai');
	});

	// I4: the AI Foundry "Target URI" form has no `/openai` segment at all. Previously passed
	// through UNCHANGED — the same silent 404 this function exists to prevent.
	test('normalises the AI Foundry /models form instead of passing it through untouched', () => {
		expect(normaliseAzureBaseUrl('https://acme.services.ai.azure.com/models')).toBe(
			'https://acme.services.ai.azure.com/models/openai'
		);
	});
});

describe('buildByokModel', () => {
	test('Azure: the deployment name is the model id', () => {
		expect(buildByokModel(AZURE, 'sk-test').unguardedModel.modelId).toBe('prod-mini');
	});

	// I3: a plain doc comment ("callers MUST wrap it with applyGuardrails()") is not an
	// invariant — a type is. buildByokModel must return the opaque Unguarded wrapper, not a
	// bare model that would typecheck straight into generateText's `model:`.
	test('returns an Unguarded wrapper, not a bare LanguageModel', () => {
		const wrapped = buildByokModel(AZURE, 'sk-test');
		expect(Object.hasOwn(wrapped, 'unguardedModel')).toBe(true);
		expect(Object.hasOwn(wrapped, 'doGenerate')).toBe(false);
		expect(Object.hasOwn(wrapped, 'specificationVersion')).toBe(false);
	});

	// createAzure throws if given both; catch it at construction with a clear message.
	test('Azure: resourceName XOR baseURL — both is an error', () => {
		expect(() => buildByokModel({ ...AZURE, baseURL: 'https://acme.openai.azure.com/openai' }, 'sk-test')).toThrow(
			InvalidCredentialError
		);
	});
	test('Azure: resourceName XOR baseURL — neither is an error', () => {
		expect(() => buildByokModel({ ...AZURE, resourceName: null }, 'sk-test')).toThrow(InvalidCredentialError);
	});

	test('OPENAI_COMPATIBLE requires a baseURL', () => {
		expect(() =>
			buildByokModel({ ...AZURE, provider: 'OPENAI_COMPATIBLE', resourceName: null }, 'sk-test')
		).toThrow(InvalidCredentialError);
	});

	test('non-Azure providers use defaultModelId as the model id', () => {
		const model = buildByokModel(
			{ ...AZURE, defaultModelId: 'claude-haiku-4-5', provider: 'ANTHROPIC', resourceName: null },
			'sk-test'
		);
		expect(model.unguardedModel.modelId).toBe('claude-haiku-4-5');
	});

	test('an empty defaultModelId is an error, not a silently empty model id', () => {
		expect(() => buildByokModel({ ...AZURE, defaultModelId: '' }, 'sk-test')).toThrow(InvalidCredentialError);
	});
});

describe('resolveModel', () => {
	test('no credential -> the platform model', async () => {
		const resolved = await resolveModel('user-1');
		expect(resolved.byok).toBe(false);
		expect(resolved.providerId).toBe('azure');
		expect(resolved.modelId).toBe('platform-deployment');
		expect(resolved.resolvedModel).toBe('gpt-5.4-mini');
		expect(openArgs.length).toBe(0);
	});

	// SECURITY: the lookup must be scoped to THIS user and to enabled rows. A missing
	// `userId` in the where-clause hands one user another user's API key.
	test('the credential lookup is scoped to the caller and to enabled rows', async () => {
		await resolveModel('user-1');
		expect(findFirstArgs.length).toBe(1);
		const args = findFirstArgs[0] as { where?: Record<string, unknown> } | undefined;
		expect(args?.where?.userId).toBe('user-1');
		expect(args?.where?.enabled).toBe(true);
	});

	test('BYOK: byok is true, modelId is the deployment, resolvedModel is the real model', async () => {
		credential = { ...ROW };
		const resolved = await resolveModel('user-1');
		expect(resolved.byok).toBe(true);
		expect(resolved.providerId).toBe('azure');
		expect(resolved.modelId).toBe('user-mini-deployment');
		// NEVER the deployment name — pricing on that yields UNKNOWN_MODEL.
		expect(resolved.resolvedModel).toBe('gpt-5.4-mini');
	});

	// SECURITY: the AAD binds the ciphertext to (userId, provider). If we ever passed the
	// ROW's userId instead of the CALLER's, a stolen row would decrypt fine for anyone.
	test('the sealed blob is opened with the CALLER userId and the row provider (AAD)', async () => {
		credential = { ...ROW, userId: 'somebody-else' };
		await resolveModel('user-1');
		expect(openArgs).toEqual([{ provider: 'AZURE', userId: 'user-1' }]);
	});

	// An unusable BYOK credential must NOT fall through to the platform model: that silently
	// moves the user's spend onto the platform's card, bypassing the very reason they are BYOK.
	test('an invalid credential throws — it never falls back to the platform', async () => {
		credential = { ...ROW, baseURL: 'https://acme.openai.azure.com/openai' }; // both set
		await expect(resolveModel('user-1')).rejects.toThrow(InvalidCredentialError);
	});
});

// C1: this is THE property the whole guardrail exists for — BYOK bypasses platform QUOTA and
// NOTHING else. Earlier coverage (guardrails.test.ts) proved `applyGuardrails` works in
// isolation and that `GUARDRAIL_STACK[0] === guardrails`; neither drives `resolveModel`, so
// neither would notice `model: applyGuardrails(model)` silently degraded to `model: model`.
// This test drives the REAL `resolveModel` -> the REAL `buildByokModel` -> the REAL (mocked
// factory, spied model) provider, through the REAL `generateText`, and inspects what actually
// reached `doGenerate`.
describe('resolveModel — guardrail attachment on the BYOK path (mutation-tested)', () => {
	test('the model resolveModel() returns has temperature stripped and output clamped', async () => {
		credential = { ...ROW };
		const resolved = await resolveModel('user-1');
		expect(resolved.byok).toBe(true);

		await generateText({
			maxOutputTokens: 999_999,
			model: resolved.model,
			prompt: 'hi',
			temperature: 2
		});

		expect(azureModelsCreated.length).toBe(1);
		const spy = azureModelsCreated[0];
		expect(spy).toBeDefined();
		expect(spy?.doGenerateCalls.length).toBe(1);
		const seen = spy?.doGenerateCalls[0] as unknown as Record<string, unknown>;
		expect(Object.hasOwn(seen, 'temperature')).toBe(false);
		expect(seen.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
	});
});

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { APICallError } from '@ai-sdk/provider';
import { TRPCError } from '@trpc/server';
import { MockLanguageModelV4 } from 'ai/test';
import type { createTRPCContext } from '@/server/api/trpc';

/**
 * `aiImport.preview`'s failure LOG is a leak route: a provider (a self-hosted OPENAI_COMPATIBLE
 * gateway especially) can echo the caller's key or auth header into `err.message`, and the router
 * logs that message. The decrypted BYOK key never leaves `resolveModel`, so the log is redacted by
 * credential shape (`safeProviderErrorMessage(err, null)`), and these tests prove it end to end.
 *
 * Hermetic, like `ai-credentials.test.ts`: `@/server/db` is replaced (the preview fails at the
 * mapping step, before any query), and `resolveModel` is overridden — spread from the real module
 * so `InvalidCredentialError` keeps its identity — to hand back a MockLanguageModelV4 whose provider
 * call throws. `mapColumns` and the AI SDK's `generateObject` run for real, so the error reaching
 * the router is the one the SDK actually propagates. No network.
 */

mock.module('@/server/db', () => ({ db: {} }));

let providerError: Error = new Error('unset');
const actualResolveModel = await import('@/server/ai/resolve-model');
mock.module('@/server/ai/resolve-model', () => ({
	...actualResolveModel,
	resolveModel: async () => ({
		byok: true,
		model: new MockLanguageModelV4({
			doGenerate: async () => {
				throw providerError;
			}
		}),
		modelId: 'gw-model',
		providerId: 'openai_compatible',
		resolvedModel: 'gw-model'
	})
}));

const { aiImportRouter } = await import('@/server/api/routers/ai-import');
const { createCallerFactory } = await import('@/server/api/trpc');
type Ctx = Awaited<ReturnType<typeof createTRPCContext>>;

const caller = createCallerFactory(aiImportRouter)({
	apiKeyPermissions: null,
	headers: new Headers(),
	session: {
		session: { id: 'test-session', token: 'test', userId: 'u1' },
		user: { email: 'u1@invest-igator.test', id: 'u1', name: 'test', role: 'user' }
	}
} as unknown as Ctx);

const CSV = 'Trade Date,Ticker,Action,Qty,Price\n01/15/2026,AAPL,B,10,150.5';
const input = { csv: CSV, model: { kind: 'byok' as const, provider: 'OPENAI_COMPATIBLE' as const } };

/** A key with no well-known prefix: only its header label (or the exact plaintext) gives it away. */
const GATEWAY_KEY = 'gw-live-0123456789abcdef';

const methods = ['error', 'warn', 'log', 'info'] as const;
let spies: Array<ReturnType<typeof spyOn>> = [];

beforeEach(() => {
	spies = methods.map((method) => spyOn(console, method).mockImplementation(() => {}));
});
afterEach(() => {
	for (const spy of spies) spy.mockRestore();
});

/** Everything written to the console during the call, as one string. */
function logged(): string {
	return spies.flatMap((spy) => spy.mock.calls.flat().map((arg) => String(arg))).join('\n');
}

async function previewFailure(): Promise<TRPCError> {
	const error = await caller.preview(input).then(
		() => null,
		(e: unknown) => e
	);
	if (!(error instanceof TRPCError)) throw new Error(`expected a TRPCError, got ${String(error)}`);
	return error;
}

describe('aiImport.preview — a provider error is logged redacted', () => {
	test('an Authorization header echoed into the message never reaches the log', async () => {
		providerError = new APICallError({
			isRetryable: false,
			message: `Unauthorized. Gateway saw headers {"authorization":"Bearer ${GATEWAY_KEY}","x-api-key":"${GATEWAY_KEY}"}`,
			requestBodyValues: { prompt: 'Trade Date,Ticker,Action,Qty,Price' },
			statusCode: 401,
			url: 'https://gateway.internal/v1/chat/completions'
		});

		const error = await previewFailure();

		expect(error.code).toBe('BAD_REQUEST');
		expect(error.message).not.toContain(GATEWAY_KEY);
		const out = logged();
		expect(out).toContain('aiImport.preview failed:');
		expect(out).toContain('AI_APICallError: Unauthorized.');
		expect(out).toContain('"authorization":"[redacted]"');
		expect(out).not.toContain(GATEWAY_KEY);
	});

	test('an unlabelled sk- key in the message never reaches the log', async () => {
		const key = 'sk-proj-abcdefghijklmnop1234';
		providerError = new APICallError({
			isRetryable: false,
			message: `Incorrect API key provided: ${key}.`,
			requestBodyValues: {},
			statusCode: 401,
			url: 'https://api.openai.com/v1/chat/completions'
		});

		await previewFailure();

		const out = logged();
		expect(out).toContain('Incorrect API key provided: [redacted].');
		expect(out).not.toContain(key);
	});

	test('a Google ?key= URL in a fetch failure never reaches the log', async () => {
		const key = `AIza${'Q'.repeat(35)}`;
		providerError = new TypeError(
			`fetch failed: https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent?key=${key}`
		);

		await previewFailure();

		const out = logged();
		expect(out).toContain('TypeError: fetch failed');
		expect(out).not.toContain(key);
	});
});

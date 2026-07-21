import { describe, expect, mock, test } from 'bun:test';

/**
 * Hermetic like tool-ctx.test.ts / resolve-model.test.ts / gateway.test.ts: this is the repo's
 * FIRST route-handler test, so it mocks EVERY module the handler imports — no real session, DB,
 * or model construction happens here. `mock.module` calls MUST run before the dynamic
 * `await import('./route')` below (bun's module cache resolves imports at that point).
 *
 * `QuotaExceededError`/`InvalidCredentialError` are imported for real (not mocked) — the route
 * under test does the same, and both this file and route.ts must share the SAME class reference
 * for `instanceof` to work, which only holds if neither `@/server/ai/quota` nor
 * `@/server/ai/resolve-model` is replaced by `mock.module`.
 */

let session: { user: { id: string } } | null = null;
mock.module('@/lib/auth/get-session', () => ({
	getServerSession: async () => session
}));

let ownedCredential: { id: string } | null = null;
const findFirstCalls: unknown[] = [];
mock.module('@/server/db', () => ({
	db: {
		aiProviderCredential: {
			findFirst: async (args: unknown) => {
				findFirstCalls.push(args);
				return ownedCredential;
			}
		}
	}
}));

let platformIsConfigured = true;
mock.module('@/server/ai/registry', () => ({
	platformModel: () => {
		if (!platformIsConfigured) {
			throw new Error('No platform LLM configured.');
		}
		return {
			byok: false,
			model: {},
			modelId: 'platform-deployment',
			providerId: 'azure',
			resolvedModel: 'gpt-5.4-mini'
		};
	}
}));

let createChatResult = { id: 'new-chat-id' };
const createChatCalls: Array<{ userId: string; title: string }> = [];
mock.module('@/server/ai/chat/persistence', () => ({
	createChat: async (userId: string, title: string) => {
		createChatCalls.push({ title, userId });
		return createChatResult;
	},
	deriveTitle: (firstUserText: string) => {
		const line = firstUserText.split('\n')[0]?.trim() ?? '';
		return line.length === 0 ? 'New chat' : line.slice(0, 60);
	}
}));

let gatewayImpl: () => Promise<Response> = async () => new Response('ok');
const gatewayCalls: unknown[] = [];
mock.module('@/server/ai/chat/gateway', () => ({
	streamChatTurn: async (args: unknown) => {
		gatewayCalls.push(args);
		return gatewayImpl();
	}
}));

const { POST } = await import('./route');
const { QuotaExceededError } = await import('@/server/ai/quota');
const { InvalidCredentialError } = await import('@/server/ai/resolve-model');

function validBody(
	overrides: Partial<{ chatId: string | undefined; message: unknown; model: unknown }> = {}
): Record<string, unknown> {
	const body: Record<string, unknown> = {
		chatId: 'chat-1',
		message: { id: 'm1', parts: [{ text: 'Hello', type: 'text' }], role: 'user' },
		model: { kind: 'platform' },
		...overrides
	};
	if (body.chatId === undefined) delete body.chatId;
	return body;
}

function post(body: unknown, init: Omit<RequestInit, 'body' | 'method'> = {}): Promise<Response> {
	const payload = typeof body === 'string' ? body : JSON.stringify(body);
	return POST(new Request('http://x/api/ai/chat', { body: payload, method: 'POST', ...init }));
}

/** Resets every piece of shared mutable mock state to its default "happy path" value. */
function resetMocks(): void {
	session = { user: { id: 'u1' } };
	ownedCredential = null;
	platformIsConfigured = true;
	createChatResult = { id: 'new-chat-id' };
	createChatCalls.length = 0;
	findFirstCalls.length = 0;
	gatewayCalls.length = 0;
	gatewayImpl = async () => new Response('ok');
}

describe('POST /api/ai/chat', () => {
	test('401 when unauthenticated', async () => {
		resetMocks();
		session = null;
		const res = await post(validBody());
		expect(res.status).toBe(401);
		expect(gatewayCalls).toHaveLength(0);
	});

	test('400 on a malformed body', async () => {
		resetMocks();
		const res = await post('{"nope":true}');
		expect(res.status).toBe(400);
	});

	test('400 on invalid JSON', async () => {
		resetMocks();
		const res = await post('not json at all');
		expect(res.status).toBe(400);
	});

	test('400 when the model selector kind is unknown', async () => {
		resetMocks();
		const res = await post(validBody({ model: { kind: 'bogus' } }));
		expect(res.status).toBe(400);
	});

	test('403 when byok selector names a provider the user does not have', async () => {
		resetMocks();
		ownedCredential = null;
		const res = await post(validBody({ model: { kind: 'byok', provider: 'ANTHROPIC' } }));
		expect(res.status).toBe(403);
		expect(gatewayCalls).toHaveLength(0);
		const lastArgs = findFirstCalls.at(-1) as { where?: { userId?: string; provider?: string; enabled?: boolean } };
		expect(lastArgs.where).toEqual({ enabled: true, provider: 'ANTHROPIC', userId: 'u1' });
	});

	test('200 when byok selector names a provider the user owns', async () => {
		resetMocks();
		ownedCredential = { id: 'cred-1' };
		const res = await post(validBody({ model: { kind: 'byok', provider: 'ANTHROPIC' } }));
		expect(res.status).toBe(200);
		expect(gatewayCalls).toHaveLength(1);
	});

	test('409 when platform selector is used but no platform model is configured', async () => {
		resetMocks();
		platformIsConfigured = false;
		const res = await post(validBody());
		expect(res.status).toBe(409);
		expect(gatewayCalls).toHaveLength(0);
	});

	test('streams when authed with a valid platform selector', async () => {
		resetMocks();
		const res = await post(validBody());
		expect(res.status).toBe(200);
		expect(gatewayCalls).toHaveLength(1);
		expect(await res.text()).toBe('ok');
	});

	test('passes only the newest message, the selector and the abort signal through to the gateway', async () => {
		resetMocks();
		const message = { id: 'm1', parts: [{ text: 'Hello', type: 'text' }], role: 'user' };
		await post(validBody({ chatId: 'chat-42', message, model: { kind: 'platform' } }));
		const call = gatewayCalls.at(0) as {
			chatId: string;
			incoming: unknown;
			selector: unknown;
			session: unknown;
			abortSignal: unknown;
		};
		expect(call.chatId).toBe('chat-42');
		expect(call.incoming).toEqual(message);
		expect(call.selector).toEqual({ kind: 'platform' });
		expect(call.session).toEqual(session);
		expect(call.abortSignal).toBeInstanceOf(AbortSignal);
	});

	test('creates a chat and derives its title from the message when chatId is omitted', async () => {
		resetMocks();
		createChatResult = { id: 'brand-new-chat' };
		const body = validBody({
			chatId: undefined,
			message: {
				id: 'm1',
				parts: [{ text: 'What is my portfolio worth?\nExtra line', type: 'text' }],
				role: 'user'
			}
		});
		const res = await post(body);
		expect(res.status).toBe(200);
		expect(createChatCalls).toEqual([{ title: 'What is my portfolio worth?', userId: 'u1' }]);
		const call = gatewayCalls.at(0) as { chatId: string };
		expect(call.chatId).toBe('brand-new-chat');
	});

	test('429 when the gateway throws QuotaExceededError', async () => {
		resetMocks();
		gatewayImpl = async () => {
			throw new QuotaExceededError('u1', 1_000_000n);
		};
		const res = await post(validBody());
		expect(res.status).toBe(429);
	});

	test('402 when the gateway throws InvalidCredentialError', async () => {
		resetMocks();
		gatewayImpl = async () => {
			throw new InvalidCredentialError('bad credential');
		};
		const res = await post(validBody());
		expect(res.status).toBe(402);
	});

	test('500 when the gateway throws an unexpected error', async () => {
		resetMocks();
		gatewayImpl = async () => {
			throw new Error('boom');
		};
		const res = await post(validBody());
		expect(res.status).toBe(500);
	});
});

import { describe, expect, mock, test } from 'bun:test';

let enableMcp = true;
mock.module('@/env', () => ({
	env: {
		get ENABLE_MCP() {
			return enableMcp;
		}
	}
}));

let verified: { userId: string; scopes: Set<string> } | null = { scopes: new Set(), userId: 'u1' };
const verifyCalls: string[] = [];
mock.module('@/server/ai/mcp/verify-key', () => ({
	verifyMcpKey: async (bearer: string) => {
		verifyCalls.push(bearer);
		return verified;
	}
}));

mock.module('@/server/ai/tool-ctx', () => ({
	createToolCtx: async (session: { user: { id: string } }, surface: string, scopes: Set<string>) => ({
		currency: 'USD',
		scopes,
		surface,
		userId: session.user.id
	})
}));
mock.module('@/server/ai/tools/registry', () => ({ buildToolset: () => [] }));
// The real buildMcpServer pulls in dbSink (→ @/server/db). Stub telemetry so this route test stays
// hermetic (no DB) while still exercising the REAL McpServer + Web transport for the bridge proof.
// mcp.ts imports classifyToolError and safeWrite too (not just dbSink) — Bun's ESM mock.module
// requires every named export the mocked module's consumers statically import to actually exist
// on the replacement, or the import throws a SyntaxError before any test runs. buildToolset() is
// stubbed to return [] above, so no tool ever actually calls these — they only need to exist.
mock.module('@/server/ai/telemetry', () => ({
	classifyToolError: () => 'Error',
	dbSink: { writeCall: async () => {}, writeToolCall: async () => {} },
	safeWrite: async (write: () => Promise<void>) => {
		await write();
	}
}));

const { POST } = await import('./route');

function initializeBody() {
	return {
		id: 1,
		jsonrpc: '2.0',
		method: 'initialize',
		params: {
			capabilities: {},
			clientInfo: { name: 'test', version: '0' },
			protocolVersion: '2025-06-18'
		}
	};
}

function req(body: unknown, headers: Record<string, string> = {}): Request {
	return new Request('http://x/api/mcp', {
		body: JSON.stringify(body),
		headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', ...headers },
		method: 'POST'
	});
}

describe('POST /api/mcp', () => {
	test('404 when ENABLE_MCP is off', async () => {
		enableMcp = false;
		verifyCalls.length = 0;
		const res = await POST(req(initializeBody(), { authorization: 'Bearer k' }));
		expect(res.status).toBe(404);
		expect(verifyCalls).toHaveLength(0); // gated before auth
	});

	test('401 when the bearer is missing', async () => {
		enableMcp = true;
		const res = await POST(req(initializeBody()));
		expect(res.status).toBe(401);
	});

	test('401 when the key is invalid', async () => {
		enableMcp = true;
		verified = null;
		const res = await POST(req(initializeBody(), { authorization: 'Bearer bad' }));
		expect(res.status).toBe(401);
		verified = { scopes: new Set(), userId: 'u1' };
	});

	test('valid key: initialize round-trips through the Web transport (bridge proof)', async () => {
		enableMcp = true;
		verified = { scopes: new Set(), userId: 'u1' };
		verifyCalls.length = 0;
		const res = await POST(req(initializeBody(), { authorization: 'Bearer good' }));
		expect(res.status).toBe(200);
		expect(verifyCalls).toEqual(['good']);
		const payload = await parseJsonRpc(res);
		expect(payload.result?.serverInfo?.name).toBe('invest-igator');
	});
});

/** The transport may answer as JSON or as a single SSE event; accept either. */
async function parseJsonRpc(res: Response): Promise<{ result?: { serverInfo?: { name?: string } } }> {
	const text = await res.text();
	const ct = res.headers.get('content-type') ?? '';
	if (ct.includes('application/json')) return JSON.parse(text);
	const line = text.split('\n').find((l) => l.startsWith('data:'));
	return JSON.parse((line ?? 'data: {}').slice('data:'.length).trim());
}

import { randomUUID } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { env } from '@/env';
import { verifyMcpKey } from '@/server/ai/mcp/verify-key';
import { createToolCtx } from '@/server/ai/tool-ctx';
import { buildMcpServer } from '@/server/ai/tools/adapters/mcp';
import { buildToolset } from '@/server/ai/tools/registry';

/** Tool calls can exceed the default 15s under load. */
export const maxDuration = 60;

function unauthorized(): Response {
	return new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), {
		headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' },
		status: 401
	});
}

/**
 * Stateless per-request MCP endpoint. Every request builds a fresh server scoped to the verified
 * key and a fresh Web-native transport, then hands the request to the transport. No session state,
 * no LLM, no quota. `ENABLE_MCP` off ⇒ the surface does not exist (404), checked before auth so it
 * cannot be probed.
 */
async function handle(req: Request): Promise<Response> {
	if (!env.ENABLE_MCP) return new Response('Not Found', { status: 404 });

	const authHeader = req.headers.get('authorization');
	const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
	if (bearer === null) return unauthorized();

	const verified = await verifyMcpKey(bearer);
	if (verified === null) return unauthorized();

	const requestId = randomUUID();
	const ctx = await createToolCtx({ user: { id: verified.userId } }, 'mcp', verified.scopes);
	const tools = buildToolset(ctx);
	const server = buildMcpServer(tools, ctx, requestId);

	const transport = new WebStandardStreamableHTTPServerTransport({
		enableJsonResponse: true,
		sessionIdGenerator: undefined
	});
	await server.connect(transport);
	return transport.handleRequest(req);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;

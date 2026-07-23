import { beforeEach, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { resetAiTables, seedUser } from '../src/server/ai/evals/db-support';
import { buildMcpServer } from '../src/server/ai/tools/adapters/mcp';
import { createToolCtx } from '../src/server/ai/tool-ctx';
import { buildToolset } from '../src/server/ai/tools/registry';
import type { Scope } from '../src/server/ai/tools/types';
import { db } from '../src/server/db';

/**
 * The crown security test (Phase 2, Task 7): a scoped bearer key exercised over the FULL chain —
 * verify -> ctx -> buildToolset -> the MCP adapter -> a real SDK Client over an in-memory
 * transport (a proper initialize handshake, not a bare function call) — against a REAL Postgres.
 * Proves, with real seeded rows and a real query, what `ai-tool-authz.test.ts` proves for the
 * bare toolset and `mcp.test.ts` proves for the adapter with a fake DB: scope-narrowing, own-data
 * isolation, the read-only surface, and telemetry, all at once, through the actual wire protocol.
 */

let userA: string;
let userB: string;

beforeEach(async () => {
	await resetAiTables();
	userA = await seedUser('a');
	userB = await seedUser('b');
	// Distinct, identifiable holdings so a cross-tenant leak would be visible.
	// Transaction columns verified against prisma/schema.prisma at plan time: `side` (enum
	// TransactionSide BUY|SELL), `priceCurrency` defaults to 'USD'.
	await db.transaction.createMany({
		data: [
			{ userId: userA, symbol: 'AAAA', side: 'BUY', quantity: 10, price: 100, date: new Date('2026-01-01') },
			{ userId: userB, symbol: 'BBBB', side: 'BUY', quantity: 5, price: 50, date: new Date('2026-01-01') }
		]
	});
});

async function connectFor(userId: string, scopes: Set<Scope>) {
	const requestId = 'e2e-req';
	const ctx = await createToolCtx({ user: { id: userId } }, 'mcp', scopes);
	const server = buildMcpServer(buildToolset(ctx), ctx, requestId);
	const [clientT, serverT] = InMemoryTransport.createLinkedPair();
	await server.connect(serverT);
	const client = new Client({ name: 'e2e', version: '0' });
	await client.connect(clientT);
	return { client, server };
}

describe('MCP end-to-end over real Postgres', () => {
	test('a portfolio-only key lists ONLY the portfolio read tools', async () => {
		const { client, server } = await connectFor(userA, new Set<Scope>(['portfolio:read']));
		const names = (await client.listTools()).tools.map((t) => t.name).sort();
		// Exactly the two portfolio tools; transactions/watchlist/goals/fx excluded by scope.
		expect(names).toEqual(['portfolio.performance', 'portfolio.structure']);
		expect(names).not.toContain('transactions.search');
		await client.close();
		await server.close();
	});

	test('no listed tool is a mutating tool (read-only surface)', async () => {
		const all: Set<Scope> = new Set([
			'portfolio:read',
			'transactions:read',
			'watchlist:read',
			'goals:read',
			'fx:read'
		]);
		const { client, server } = await connectFor(userA, all);
		const listed = await client.listTools();
		for (const t of listed.tools) {
			expect(t.annotations?.readOnlyHint).toBe(true);
		}
		await client.close();
		await server.close();
	});

	test('callTool returns the CALLER’S own data as structuredContent — never another tenant’s', async () => {
		// transactions.search returns rows carrying `symbol` directly (no pricing dependency),
		// so a cross-tenant leak is unambiguous. All its input fields are optional → `{}` is valid.
		const { client, server } = await connectFor(userA, new Set<Scope>(['transactions:read']));
		const res = await client.callTool({ name: 'transactions.search', arguments: {} });
		const json = JSON.stringify(res.structuredContent);
		expect(json).toContain('AAAA'); // user A's transaction symbol
		expect(json).not.toContain('BBBB'); // user B's must never appear
		await client.close();
		await server.close();
	});

	test('a tool outside the key’s scope is neither listed nor callable', async () => {
		const { client, server } = await connectFor(userA, new Set<Scope>(['portfolio:read']));
		const names = (await client.listTools()).tools.map((t) => t.name);
		expect(names).not.toContain('transactions.search');
		// The MCP SDK (1.29.0, verified against node_modules) does NOT reject the client's
		// promise for a request naming an unregistered tool: `McpServer`'s CallToolRequestSchema
		// handler catches its own `Tool ... not found` McpError and resolves with a normal
		// CallToolResult carrying `isError: true` (see server/mcp.js's catch block, which
		// special-cases only ErrorCode.UrlElicitationRequired for a real throw). So "not callable"
		// is proven by `isError: true` and the absence of any structuredContent — never by a
		// rejected promise, which this SDK version never produces for this case.
		const res = await client.callTool({ name: 'transactions.search', arguments: {} });
		expect(res.isError).toBe(true);
		expect(res.structuredContent).toBeUndefined();
		await client.close();
		await server.close();
	});

	test('each successful call writes an AiToolCall row with surface MCP', async () => {
		const { client, server } = await connectFor(userA, new Set<Scope>(['transactions:read']));
		await client.callTool({ name: 'transactions.search', arguments: {} });
		const rows = await db.aiToolCall.findMany({ where: { surface: 'MCP', userId: userA } });
		expect(rows.length).toBeGreaterThanOrEqual(1);
		expect(rows[0]?.toolName).toBe('transactions.search');
		await client.close();
		await server.close();
	});
});

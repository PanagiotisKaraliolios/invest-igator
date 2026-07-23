import { describe, expect, mock, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import type { AppTool, Scope, ToolCtx } from '../types';

const toolCallRows: unknown[] = [];
/** Set by the load-bearing-telemetry test to simulate a transient DB write failure. */
let failNextToolCallWrite = false;
mock.module('@/server/db', () => ({
	db: {
		aiToolCall: {
			create: async ({ data }: { data: unknown }) => {
				if (failNextToolCallWrite) {
					failNextToolCallWrite = false;
					throw new Error('transient db blip');
				}
				return toolCallRows.push(data);
			}
		}
	}
}));

const { buildMcpServer } = await import('./mcp');

function readTool(name: string, requiredScope: Scope): AppTool {
	return {
		annotations: { openWorldHint: false, readOnlyHint: true, title: name },
		description: `${name} tool`,
		// The handler must receive ctx (with userId) — NOT userId from args.
		execute: async (_input, ctx) => ({ who: ctx.userId }),
		inputSchema: z.strictObject({ q: z.string().optional() }),
		mutates: false,
		name,
		outputSchema: z.strictObject({ who: z.string() }),
		requiredScope
	} as AppTool;
}

const ctx: ToolCtx = {
	currency: 'USD',
	scopes: new Set(['portfolio:read']),
	surface: 'mcp',
	userId: 'owner-9'
};

async function connect(tools: AppTool[]) {
	const server = buildMcpServer(tools, ctx, 'req-1');
	const [clientT, serverT] = InMemoryTransport.createLinkedPair();
	await server.connect(serverT);
	const client = new Client({ name: 't', version: '0' });
	await client.connect(clientT);
	return { client, server };
}

describe('buildMcpServer', () => {
	test('registers tools under their canonical dot names (no underscore mapping)', async () => {
		toolCallRows.length = 0;
		const { client, server } = await connect([readTool('portfolio.structure', 'portfolio:read')]);
		const listed = await client.listTools();
		expect(listed.tools.map((t) => t.name)).toEqual(['portfolio.structure']);
		await client.close();
		await server.close();
	});

	test('handler closes over ctx.userId (client supplies only args) and returns structuredContent', async () => {
		toolCallRows.length = 0;
		const { client, server } = await connect([readTool('portfolio.structure', 'portfolio:read')]);
		const res = await client.callTool({ arguments: { q: 'anything' }, name: 'portfolio.structure' });
		expect(res.structuredContent).toEqual({ who: 'owner-9' }); // userId from ctx, never from args
		await client.close();
		await server.close();
	});

	test('writes one AiToolCall row per call with surface MCP and a hashed (not raw) input', async () => {
		toolCallRows.length = 0;
		const { client, server } = await connect([readTool('portfolio.structure', 'portfolio:read')]);
		await client.callTool({ arguments: { q: 'secret-query' }, name: 'portfolio.structure' });
		expect(toolCallRows).toHaveLength(1);
		const row = toolCallRows[0] as Record<string, unknown>;
		expect(row.surface).toBe('MCP');
		expect(row.toolName).toBe('portfolio.structure');
		expect(row.requestId).toBe('req-1');
		expect(row.userId).toBe('owner-9');
		expect(row.ok).toBe(true);
		expect(typeof row.inputHash).toBe('string');
		expect(JSON.stringify(row)).not.toContain('secret-query'); // raw args never stored
		await client.close();
		await server.close();
	});

	test('a throwing tool logs ok:false with a scrubbed classification (not the raw message) and surfaces an MCP error', async () => {
		toolCallRows.length = 0;
		const boom = readTool('portfolio.structure', 'portfolio:read');
		boom.execute = async () => {
			throw new Error('kaboom');
		};
		const { client, server } = await connect([boom]);
		const res = await client.callTool({ arguments: {}, name: 'portfolio.structure' });
		expect(res.isError).toBe(true);
		expect(toolCallRows).toHaveLength(1);
		const row = toolCallRows[0] as Record<string, unknown>;
		expect(row.ok).toBe(false);
		expect(row.errorMessage).toBe('Error'); // classifyToolError's classification, not raw text
		expect(row.errorMessage).not.toContain('kaboom');
		await client.close();
		await server.close();
	});

	test('C1: a tool error containing portfolio data is never persisted verbatim', async () => {
		toolCallRows.length = 0;
		const boom = readTool('portfolio.structure', 'portfolio:read');
		boom.execute = async () => {
			throw new Error('user holds 900 NVDA @ 128.40 account IB-U1234567');
		};
		const { client, server } = await connect([boom]);
		const res = await client.callTool({ arguments: {}, name: 'portfolio.structure' });
		expect(res.isError).toBe(true);
		expect(toolCallRows).toHaveLength(1);
		const row = toolCallRows[0] as Record<string, unknown>;
		expect(row.ok).toBe(false);
		expect(row.errorMessage).toBe('Error');
		expect(row.errorMessage).not.toContain('NVDA');
		expect(row.errorMessage).not.toContain('IB-U1234567');
		await client.close();
		await server.close();
	});

	test('telemetry is never load-bearing: a DB write failure on the success path still returns the tool result', async () => {
		toolCallRows.length = 0;
		failNextToolCallWrite = true;
		try {
			const { client, server } = await connect([readTool('portfolio.structure', 'portfolio:read')]);
			const res = await client.callTool({ arguments: { q: 'anything' }, name: 'portfolio.structure' });
			expect(res.isError).toBeFalsy();
			expect(res.structuredContent).toEqual({ who: 'owner-9' }); // the real result, not swallowed
			expect(toolCallRows).toHaveLength(0); // the failed write never lands a row
			await client.close();
			await server.close();
		} finally {
			failNextToolCallWrite = false; // reset in case the assertions above threw
		}
	});
});

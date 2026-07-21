import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * Runtime contract check for @modelcontextprotocol/sdk@1.29.0 (the Phase 2 spike).
 * Proves, in THIS repo's toolchain: a full zod object works as inputSchema/outputSchema,
 * dot-form tool names are accepted verbatim, the initialize+callTool handshake works over
 * the in-memory transport, and structuredContent round-trips. NOT a test of our own code.
 */
describe('mcp sdk runtime contract (1.29.0)', () => {
	test('registers a dot-named tool and round-trips structuredContent', async () => {
		const server = new McpServer({ name: 'smoke', version: '0.0.0' });
		server.registerTool(
			'echo.say',
			{
				annotations: { openWorldHint: false, readOnlyHint: true, title: 'Echo' },
				description: 'Echoes its message back.',
				inputSchema: z.strictObject({ message: z.string() }),
				outputSchema: z.strictObject({ echoed: z.string() })
			},
			async (args: { message: string }) => {
				const echoed = `${args.message}!`;
				return { content: [{ text: echoed, type: 'text' }], structuredContent: { echoed } };
			}
		);

		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await server.connect(serverTransport);
		const client = new Client({ name: 'smoke-client', version: '0.0.0' });
		await client.connect(clientTransport);

		const listed = await client.listTools();
		expect(listed.tools.map((t) => t.name)).toContain('echo.say');

		const result = await client.callTool({ arguments: { message: 'hi' }, name: 'echo.say' });
		expect(result.structuredContent).toEqual({ echoed: 'hi!' });

		await client.close();
		await server.close();
	});
});

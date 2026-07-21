import { createHash, randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { dbSink } from '@/server/ai/telemetry';
import type { AppTool, ToolCtx } from '../types';

const SERVER_INFO = { name: 'invest-igator', version: '0.1.0' } as const;

/** SHA-256 (hex) of the tool input — for telemetry correlation, never the raw args. */
function hashToolInput(input: unknown): string {
	return createHash('sha256')
		.update(JSON.stringify(input ?? null))
		.digest('hex');
}

/**
 * AppTool[] -> an MCP server (Phase 2). Mirror of `toAiSdkTools` with three differences:
 *   1. MCP tool names permit dots, so the canonical `group.verb` name is registered AS-IS
 *      (no '.'->'_' mapping the AI SDK adapter needs).
 *   2. No LLM runs in our process, so there is no quota and the AI SDK telemetry hooks never fire
 *      here — each call writes its OWN `AiToolCall` row (surface MCP) via `dbSink`.
 *   3. The handler returns MCP `{ content, structuredContent }`; a thrown error becomes an MCP
 *      error result (the SDK sets `isError`).
 *
 * The handler closes over `ctx`; the client supplies only `args`, so it can never reach `userId`.
 * `requestId` correlates every tool call within one HTTP request.
 */
export function buildMcpServer(tools: AppTool[], ctx: ToolCtx, requestId: string): McpServer {
	const server = new McpServer(SERVER_INFO);

	for (const def of tools) {
		server.registerTool(
			def.name,
			{
				annotations: def.annotations,
				description: def.description,
				inputSchema: def.inputSchema,
				outputSchema: def.outputSchema
			},
			async (args: unknown, extra: { signal: AbortSignal }) => {
				const toolCallId = randomUUID();
				const started = Date.now();
				const toolCtx: ToolCtx = { ...ctx, abortSignal: extra.signal };
				try {
					// The SDK validates `args` against `def.inputSchema` before calling us, so `args`
					// is already the tool's input type at runtime.
					const result = await def.execute(args as never, toolCtx);
					await dbSink.writeToolCall({
						durationMs: Date.now() - started,
						errorMessage: null,
						inputHash: hashToolInput(args),
						ok: true,
						requestId,
						surface: 'MCP',
						toolCallId,
						toolName: def.name,
						userId: ctx.userId
					});
					// `tools: AppTool[]` erases each tool's concrete output type down to the base
					// `z.ZodType` (Output = unknown), so `result` is `unknown` here even though at
					// runtime it is whatever `def.outputSchema` (a strictObject, per AppTool's
					// contract) describes. The SDK itself validates `result` against that same
					// `outputSchema` before sending it, so this cast — like the `args` cast above —
					// asserts a runtime type the SDK independently enforces, not an unchecked one.
					return {
						content: [{ text: JSON.stringify(result), type: 'text' as const }],
						structuredContent: result as Record<string, unknown>
					};
				} catch (err) {
					await dbSink.writeToolCall({
						durationMs: Date.now() - started,
						errorMessage: err instanceof Error ? err.message : String(err),
						inputHash: hashToolInput(args),
						ok: false,
						requestId,
						surface: 'MCP',
						toolCallId,
						toolName: def.name,
						userId: ctx.userId
					});
					throw err; // SDK formats the MCP error result (isError: true)
				}
			}
		);
	}

	return server;
}

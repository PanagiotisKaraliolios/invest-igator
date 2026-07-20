import type { z } from 'zod';
import type { Currency } from '@/lib/currency';

/**
 * THE Phase 0 interface. One descriptor; three adapters (chat, MCP, cron).
 *
 * The security model lives in two rules, and both are tested, not asserted:
 *   1. `userId` is NEVER a field in any inputSchema. It comes only from ToolCtx.
 *      The model cannot name another user's id because there is no argument to put it in.
 *   2. Every inputSchema is z.strictObject — unknown keys are rejected, not forwarded.
 *
 * MCP annotations are UX hints, NOT authorization. Enforcement is requiredScope + buildToolset.
 *
 * Tool names are `group.verb` and MUST NOT contain an underscore: the AI SDK adapter maps
 * '.' -> '_' (dots are illegal in AI SDK tool names) and that mapping is only reversible
 * while the canonical names are underscore-free. registry.test.ts enforces it.
 */

export type Scope = `${'portfolio' | 'transactions' | 'watchlist' | 'goals' | 'fx'}:${'read' | 'write'}`;

export type ToolCtx = {
	/** From the session or the API key. NEVER from model input. */
	readonly userId: string;
	readonly scopes: ReadonlySet<Scope>;
	readonly surface: 'chat' | 'mcp' | 'cron' | 'eval';
	readonly currency: Currency;
	/** Set by the adapters from the surface's own signal, so a cancelled request cancels the tool. */
	readonly abortSignal?: AbortSignal;
};

export type AppTool<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> = {
	/** Dot form, e.g. 'portfolio.structure'. The AI SDK adapter maps dots to underscores. */
	name: string;
	description: string;
	/** MUST be z.strictObject. MUST NOT contain userId. */
	inputSchema: I;
	/** Mandatory: MCP structuredContent, the chat's typed part.output, and the eval harness all need it. */
	outputSchema: O;
	requiredScope: Scope;
	/** Phase 0: always false. The field exists now so Phase 3's write tools are additive. */
	mutates: boolean;
	/** Required when mutates is true. Phase 0 never sets it. */
	preview?: (input: z.infer<I>, ctx: ToolCtx) => Promise<string>;
	annotations: {
		title: string;
		readOnlyHint: boolean;
		destructiveHint?: boolean;
		idempotentHint?: boolean;
		openWorldHint: boolean;
	};
	execute: (input: z.infer<I>, ctx: ToolCtx) => Promise<z.infer<O>>;
};

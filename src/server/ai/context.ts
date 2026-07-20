import { AsyncLocalStorage } from 'node:async_hooks';

/** Mirrors the Prisma `AiSurface` enum exactly. Keep the two in lockstep. */
export type AiSurfaceName = 'CHAT' | 'MCP' | 'CRON' | 'EVAL';

/**
 * The correlation spine.
 *
 * The guardrail middleware and the telemetry integration both see a *provider call* and have no
 * idea which user it belongs to — the AI SDK does not hand them a session. AsyncLocalStorage is
 * SDK-independent and behaves identically for chat, MCP and cron, so it is what we correlate on.
 */
export type AiCallContext = {
	requestId: string;
	userId: string | null;
	surface: AiSurfaceName;
	functionId: string;
	chatId?: string;
	/** true => the call is on the user's own credential: no platform quota, `billedTo: USER`. */
	byok: boolean;
	/**
	 * The REAL model, e.g. 'gpt-5.4-mini'. This — never the SDK-reported `modelId` — is what we
	 * price on: for Azure the SDK's model id is the DEPLOYMENT NAME and matches nothing in the
	 * price catalogue.
	 */
	resolvedModel: string;
	reservationId?: string;
};

export const aiContext = new AsyncLocalStorage<AiCallContext>();

export function runWithAiContext<T>(ctx: AiCallContext, fn: () => Promise<T>): Promise<T> {
	return aiContext.run(ctx, fn);
}

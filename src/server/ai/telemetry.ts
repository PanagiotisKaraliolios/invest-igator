import { type LanguageModelUsage, registerTelemetry, type Telemetry } from 'ai';
import { type AiCallContext, type AiSurfaceName, aiContext } from '@/server/ai/context';
import { PRICE_SNAPSHOT_ID, price, type TokenUsage } from '@/server/ai/pricing/price';
import { db } from '@/server/db';

/** Mirrors the Prisma `AiCallOutcome` enum. */
export type AiCallOutcomeName = 'OK' | 'ERROR' | 'ABORTED' | 'CONTENT_FILTERED';

export type UsageColumns = {
	cacheReadTokens: number | null;
	cacheWriteTokens: number | null;
	inputTokens: number | null;
	noCacheTokens: number | null;
	outputTokens: number | null;
	reasoningTokens: number | null;
	textTokens: number | null;
	totalTokens: number | null;
};

export type AiCallRow = UsageColumns & {
	billedTo: 'PLATFORM' | 'USER';
	callId: string | null;
	chatId: string | null;
	costNanoUsd: bigint | null;
	errorCode: string | null;
	errorMessage: string | null;
	finishReason: string | null;
	functionId: string;
	kind: 'LANGUAGE_MODEL' | 'EMBEDDING';
	latencyMs: number | null;
	modelId: string;
	outcome: AiCallOutcomeName;
	priceSnapshotId: string;
	pricingStatus: 'PRICED' | 'UNKNOWN_MODEL';
	provider: string;
	requestId: string;
	resolvedModel: string;
	surface: AiSurfaceName;
	userId: string | null;
};

export type AiToolCallRow = {
	durationMs: number | null;
	errorMessage: string | null;
	inputHash: string | null;
	ok: boolean;
	requestId: string;
	surface: AiSurfaceName;
	toolCallId: string;
	toolName: string;
	userId: string | null;
};

export type LedgerSink = {
	writeCall: (row: AiCallRow) => Promise<void>;
	writeToolCall: (row: AiToolCallRow) => Promise<void>;
};

export const dbSink: LedgerSink = {
	writeCall: async (row) => {
		await db.aiCall.create({ data: row });
	},
	writeToolCall: async (row) => {
		await db.aiToolCall.create({ data: row });
	}
};

const MAX_ERROR_MESSAGE = 500;
const REDACTED = '[redacted]';

/**
 * Anything that looks like a credential is destroyed before it can be persisted. This is defence
 * in depth: `safeErrorMessage` already picks fields explicitly, so a key can only arrive here if a
 * provider interpolated it into `err.message` itself — which several of them do.
 */
const SECRET_PATTERNS: RegExp[] = [
	/(api[-_]?key|authorization|bearer|x-api-key)["'\s]*[:=]["'\s]*\S+/gi,
	/\bsk-[A-Za-z0-9_-]{8,}/g,
	/\b[A-Za-z0-9_-]{24,}\b/g
];

export function scrubSecrets(text: string): string {
	let out = text;
	for (const pattern of SECRET_PATTERNS) {
		// Module-scope regexes with /g carry lastIndex; String.replace resets it, but be explicit.
		pattern.lastIndex = 0;
		out = out.replace(pattern, REDACTED);
	}
	return out.slice(0, MAX_ERROR_MESSAGE);
}

/**
 * R8. NEVER `JSON.stringify(err)`: provider SDK errors carry the whole request config — the
 * request body (the user's portfolio) AND the request headers (their BYOK api-key). Pick the
 * fields we want by name, one at a time, and scrub what survives.
 */
export function safeErrorMessage(err: unknown): { code: string | null; message: string } {
	if (err === null || err === undefined) {
		return { code: null, message: 'unknown error' };
	}
	if (typeof err !== 'object') {
		return { code: null, message: scrubSecrets(String(err)) };
	}

	const e = err as Record<string, unknown>;
	const name = typeof e.name === 'string' ? e.name : null;
	const message = typeof e.message === 'string' ? e.message : 'unknown error';
	const status = typeof e.statusCode === 'number' ? e.statusCode : typeof e.status === 'number' ? e.status : null;
	const rawCode = typeof e.code === 'string' ? e.code : null;

	const code = rawCode ?? (status !== null ? `HTTP_${status}` : name);
	return { code, message: scrubSecrets(message) };
}

/** Only ever read for CLASSIFICATION. It is never stored — it can echo the request. */
function responseBodyOf(err: unknown): string {
	if (err === null || typeof err !== 'object') return '';
	const body = (err as Record<string, unknown>).responseBody;
	return typeof body === 'string' ? body : '';
}

function errorName(err: unknown): string | null {
	if (err === null || typeof err !== 'object') return null;
	const name = (err as Record<string, unknown>).name;
	return typeof name === 'string' ? name : null;
}

export function classifyOutcome(err: unknown): {
	code: string | null;
	message: string;
	outcome: AiCallOutcomeName;
} {
	const { code, message } = safeErrorMessage(err);
	const name = errorName(err);

	if (name === 'AbortError' || name === 'TimeoutError') {
		return { code, message, outcome: 'ABORTED' };
	}

	// Azure's content filter rejects with HTTP 400 — AND YOU ARE STILL BILLED. It is a first-class
	// outcome, not a generic error, or the spend is invisible. The code MUST be forced here: the
	// generic path derives `HTTP_400` from the status, which buries the reason.
	const haystack = `${message} ${responseBodyOf(err)}`.toLowerCase();
	if (haystack.includes('content_filter') || haystack.includes('content management policy')) {
		return { code: 'content_filter', message, outcome: 'CONTENT_FILTERED' };
	}

	return { code, message, outcome: 'ERROR' };
}

export function toTokenUsage(usage: LanguageModelUsage | undefined): TokenUsage {
	return {
		cacheReadTokens: usage?.inputTokenDetails.cacheReadTokens ?? null,
		cacheWriteTokens: usage?.inputTokenDetails.cacheWriteTokens ?? null,
		inputTokens: usage?.inputTokens ?? null,
		outputTokens: usage?.outputTokens ?? null
	};
}

export function toUsageColumns(usage: LanguageModelUsage | undefined): UsageColumns {
	return {
		cacheReadTokens: usage?.inputTokenDetails.cacheReadTokens ?? null,
		cacheWriteTokens: usage?.inputTokenDetails.cacheWriteTokens ?? null,
		inputTokens: usage?.inputTokens ?? null,
		noCacheTokens: usage?.inputTokenDetails.noCacheTokens ?? null,
		outputTokens: usage?.outputTokens ?? null,
		reasoningTokens: usage?.outputTokenDetails.reasoningTokens ?? null,
		textTokens: usage?.outputTokenDetails.textTokens ?? null,
		totalTokens: usage?.totalTokens ?? null
	};
}

/** A zero-usage probe: `price()` returns null iff the model is not in the catalogue. */
const ZERO_USAGE: TokenUsage = { cacheReadTokens: 0, cacheWriteTokens: 0, inputTokens: 0, outputTokens: 0 };

export function buildAiCallRow(args: {
	callId: string | null;
	ctx: AiCallContext;
	errorCode: string | null;
	errorMessage: string | null;
	finishReason: string | null;
	latencyMs: number | null;
	modelId: string;
	outcome: AiCallOutcomeName;
	provider: string;
	responseId: string | null;
	usage: LanguageModelUsage | undefined;
}): AiCallRow {
	// PRICE ON ctx.resolvedModel — NEVER on args.modelId. For Azure, modelId is the DEPLOYMENT
	// NAME ('my-prod-deployment'), which matches nothing in the catalogue, so every Azure row would
	// silently land as UNKNOWN_MODEL and the platform would eat the bill.
	const priced = args.usage === undefined ? null : price(args.ctx.resolvedModel, toTokenUsage(args.usage));
	// pricingStatus describes the CATALOGUE, not this row: an error row has no usage and therefore
	// no cost, but the model is still priceable. `costNanoUsd === null` is what "no cost known"
	// means. Never write 0 — a 0 fallback silently under-bills.
	const modelIsKnown = price(args.ctx.resolvedModel, ZERO_USAGE) !== null;

	return {
		...toUsageColumns(args.usage),
		billedTo: args.ctx.byok ? 'USER' : 'PLATFORM',
		callId: args.callId,
		chatId: args.ctx.chatId ?? null,
		costNanoUsd: priced?.nanoUsd ?? null,
		errorCode: args.errorCode,
		errorMessage: args.errorMessage,
		finishReason: args.finishReason,
		functionId: args.ctx.functionId,
		kind: 'LANGUAGE_MODEL',
		latencyMs: args.latencyMs,
		modelId: args.modelId,
		outcome: args.outcome,
		priceSnapshotId: PRICE_SNAPSHOT_ID,
		pricingStatus: modelIsKnown ? 'PRICED' : 'UNKNOWN_MODEL',
		provider: args.provider,
		requestId: args.ctx.requestId,
		resolvedModel: args.ctx.resolvedModel,
		surface: args.ctx.surface,
		userId: args.ctx.userId
	};
}

/**
 * The provider/model of the call currently in flight, keyed by the ALS store object (which is
 * stable for the lifetime of one request). `onError` is not given a provider or a model id, so
 * without this an error row would have to invent them.
 */
const inFlight = new WeakMap<AiCallContext, { modelId: string; provider: string; startedAt: number }>();
/** toolCallId -> start time. Cleared on onEnd/onAbort so an aborted run cannot leak entries. */
const toolStartedAt = new Map<string, number>();
const toolIdsByCtx = new WeakMap<AiCallContext, Set<string>>();

function forgetTools(ctx: AiCallContext): void {
	const ids = toolIdsByCtx.get(ctx);
	if (ids === undefined) return;
	for (const id of ids) toolStartedAt.delete(id);
	toolIdsByCtx.delete(ctx);
}

/**
 * TELEMETRY IS NEVER LOAD-BEARING. A hook that throws propagates into the user's request and turns
 * a transient Postgres blip into a 500 on a chat turn. Swallow, log, move on.
 */
async function safeWrite(write: () => Promise<void>): Promise<void> {
	try {
		await write();
	} catch (e) {
		console.error('AI telemetry sink failed', safeErrorMessage(e));
	}
}

/**
 * The `Telemetry['onError']` type is declared as `Callback<unknown>` — the SDK does not export a
 * named event type for it. At runtime it dispatches `{ callId, error }` (verified against
 * `node_modules/ai/dist/index.js`: `onError?.call(telemetryDispatcher, { callId, error })`). Cast
 * to this narrow shape rather than to `any`, so a real shape drift still fails loudly elsewhere.
 */
type OnErrorEvent = { callId?: string; error: unknown };

export function createLedgerTelemetry(sink: LedgerSink = dbSink): Telemetry {
	return {
		onAbort: () => {
			const ctx = aiContext.getStore();
			if (ctx !== undefined) forgetTools(ctx);
		},

		onEnd: () => {
			const ctx = aiContext.getStore();
			if (ctx !== undefined) forgetTools(ctx);
		},

		onError: async (event) => {
			const ctx = aiContext.getStore();
			if (ctx === undefined) return;
			// LOAD-BEARING. `onLanguageModelCallEnd` fires ONLY ON SUCCESS. Without this hook every
			// failed provider call is invisible — including Azure's content-filter 400s, which are
			// billed. This is the only place a CONTENT_FILTERED row can ever come from.
			//
			// We write the row unconditionally rather than only when a model call was in flight: a
			// spurious ERROR row (cost null) is noise, a MISSING row is invisible spend.
			const last = inFlight.get(ctx);
			const { error } = event as OnErrorEvent;
			const { code, message, outcome } = classifyOutcome(error);
			await safeWrite(async () =>
				sink.writeCall(
					buildAiCallRow({
						callId: null,
						ctx,
						errorCode: code,
						errorMessage: message,
						finishReason: null,
						latencyMs: last === undefined ? null : Math.round(performance.now() - last.startedAt),
						modelId: last?.modelId ?? ctx.resolvedModel,
						outcome,
						provider: last?.provider ?? 'unknown',
						responseId: null,
						// The provider does not report usage on a failure. Cost is therefore NULL,
						// not 0 — a filtered-but-billed call is flagged, and reconciled from the
						// provider's own invoice, never guessed.
						usage: undefined
					})
				)
			);
		},

		onLanguageModelCallEnd: async (event) => {
			const ctx = aiContext.getStore();
			if (ctx === undefined) return;
			inFlight.delete(ctx);
			await safeWrite(async () =>
				sink.writeCall(
					buildAiCallRow({
						callId: event.callId,
						ctx,
						errorCode: null,
						errorMessage: null,
						finishReason: event.finishReason,
						latencyMs: Math.round(event.performance.responseTimeMs),
						// `functionId` is flattened onto the event by the SDK too, but we take it from
						// ALS anyway, so that chat/MCP/cron all report it identically.
						modelId: event.modelId,
						outcome: 'OK',
						provider: event.provider,
						responseId: event.responseId,
						usage: event.usage
					})
				)
			);
		},

		onLanguageModelCallStart: (event) => {
			const ctx = aiContext.getStore();
			if (ctx === undefined) return;
			inFlight.set(ctx, { modelId: event.modelId, provider: event.provider, startedAt: performance.now() });
		},

		onToolExecutionEnd: async (event) => {
			const ctx = aiContext.getStore();
			if (ctx === undefined) return;
			const toolCallId = event.toolOutput.toolCallId;
			const startedAt = toolStartedAt.get(toolCallId);
			toolStartedAt.delete(toolCallId);
			toolIdsByCtx.get(ctx)?.delete(toolCallId);

			// The SDK's own JSDoc on this hook tells you to "check event.success".
			// THERE IS NO SUCH FIELD — code that follows the inline docs does not compile.
			// Discriminate on the tagged union instead.
			const output = event.toolOutput;
			const ok = output.type === 'tool-result';
			const errorMessage = output.type === 'tool-error' ? safeErrorMessage(output.error).message : null;

			await safeWrite(async () =>
				sink.writeToolCall({
					durationMs: startedAt === undefined ? null : Math.round(performance.now() - startedAt),
					errorMessage,
					// Left null on purpose: with `recordInputs: false` (mandatory — see
					// telemetry-privacy.ts) the tool input never reaches this integration, which is
					// the whole point. The AppTool adapter (Task 10) hashes the input at the call
					// site instead.
					inputHash: null,
					ok,
					requestId: ctx.requestId,
					surface: ctx.surface,
					toolCallId,
					toolName: output.toolName,
					userId: ctx.userId
				})
			);
		},

		onToolExecutionStart: (event) => {
			const ctx = aiContext.getStore();
			if (ctx === undefined) return; // no ctx => no row will be written => do not record a start
			const toolCallId = event.toolCall.toolCallId;
			toolStartedAt.set(toolCallId, performance.now());
			const ids = toolIdsByCtx.get(ctx) ?? new Set<string>();
			ids.add(toolCallId);
			toolIdsByCtx.set(ctx, ids);
		}
	};
}

/**
 * `registerTelemetry` is GLOBAL and pushes onto an array hanging off globalThis. Next.js can
 * evaluate `instrumentation.ts` more than once (dev HMR, multiple runtimes), and a second push
 * means every AiCall row is written TWICE. Guard on a globalThis symbol, which survives module
 * re-evaluation because it is keyed in the global symbol registry.
 */
const REGISTERED = Symbol.for('invest-igator.ai.telemetry.registered');
type TelemetryGlobal = typeof globalThis & { [REGISTERED]?: boolean };

export function registerAiTelemetryOnce(integration?: Telemetry): boolean {
	const g = globalThis as TelemetryGlobal;
	if (g[REGISTERED] === true) return false;
	g[REGISTERED] = true;
	registerTelemetry(integration ?? createLedgerTelemetry());
	return true;
}

import { randomUUID } from 'node:crypto';
import { convertToModelMessages, isStepCount, type LanguageModelUsage, streamText, type UIMessage } from 'ai';
import { runWithAiContext } from '@/server/ai/context';
import { price, type TokenUsage } from '@/server/ai/pricing/price';
import { PORTFOLIO_ANALYST } from '@/server/ai/prompts/portfolio-analyst';
import {
	estimateRequestCeilingNanoUsd,
	type Reservation,
	reserve as realReserve,
	settle as realSettle
} from '@/server/ai/quota';
import { MAX_STEPS, type ResolvedModel } from '@/server/ai/registry';
import { type ModelSelector, resolveModel as realResolveModel } from '@/server/ai/resolve-model';
import { toTokenUsage } from '@/server/ai/telemetry';
import { createToolCtx } from '@/server/ai/tool-ctx';
import { toAiSdkTools } from '@/server/ai/tools/adapters/ai-sdk';
import { buildToolset } from '@/server/ai/tools/registry';
import { loadTurnHistory as realLoad, saveTurn as realSave } from './persistence';

/**
 * The seam that makes this hermetically testable: `MockLanguageModelV4` swaps in for
 * `resolveModel`'s returned `model`, and `reserve`/`settle`/`loadTurnHistory`/`saveTurn` are
 * spies. `createToolCtx` is deliberately NOT part of this seam — it is cheap, side-effect-free
 * beyond a single `db.user.findUnique`, and tests make it hermetic the same way
 * `tool-ctx.test.ts` does: `mock.module('@/server/db', ...)`.
 */
type Deps = {
	resolveModel: (userId: string, selector?: ModelSelector) => Promise<ResolvedModel>;
	reserve: (userId: string, ceiling: bigint, requestId: string) => Promise<Reservation>;
	settle: (r: Reservation, actual: bigint | null) => Promise<void>;
	loadTurnHistory: (chatId: string, userId: string) => Promise<UIMessage[]>;
	saveTurn: (a: { chatId: string; userId: string; messages: UIMessage[] }) => Promise<void>;
};

const DEFAULT_DEPS: Deps = {
	loadTurnHistory: realLoad,
	reserve: realReserve,
	resolveModel: realResolveModel,
	saveTurn: realSave,
	settle: realSettle
};

/**
 * Conservative estimate of the turn's own prompt size (system prompt + tool schemas + this
 * turn's history), fed to `estimateRequestCeilingNanoUsd`. It does not need to be exact:
 * `estimateRequestCeilingNanoUsd` already inflates this by `MAX_STEPS` steps of
 * `MAX_OUTPUT_TOKENS + MAX_TOOL_RESULT_TOKENS` growth on top, and the guardrail middleware
 * clamps every single provider call's output regardless. Under-estimating here under-reserves
 * the FIRST step only — a request that turns out to need more is still bounded by the
 * per-call/per-step ceilings, just billed more precisely on `settle`.
 */
const ESTIMATED_INPUT_TOKENS = 2000;

/**
 * Sums the per-step token usage of every step that FINISHED before an abort into one
 * `TokenUsage`, so an aborted turn is settled against the partial spend it actually incurred —
 * NOT the full reserved ceiling. `onAbort` (`StreamTextOnAbortCallback`, verified against the
 * v7 `.d.ts`) exposes `steps: StepResult[]`, each carrying a `LanguageModelUsage`; zero finished
 * steps => all-zero usage => a $0 partial that still releases the reservation. (`onError`, by
 * contrast, is `StreamTextOnErrorCallback` = `{ error }` only — no usage to price — so the error
 * path settles `null`, which `settle()` coalesces to the full ceiling, the fail-safe.)
 */
function sumStepUsage(steps: ReadonlyArray<{ usage: LanguageModelUsage }>): TokenUsage {
	const total: TokenUsage = { cacheReadTokens: 0, cacheWriteTokens: 0, inputTokens: 0, outputTokens: 0 };
	for (const step of steps) {
		const u = toTokenUsage(step.usage);
		total.inputTokens = (total.inputTokens ?? 0) + (u.inputTokens ?? 0);
		total.outputTokens = (total.outputTokens ?? 0) + (u.outputTokens ?? 0);
		total.cacheReadTokens = (total.cacheReadTokens ?? 0) + (u.cacheReadTokens ?? 0);
		total.cacheWriteTokens = (total.cacheWriteTokens ?? 0) + (u.cacheWriteTokens ?? 0);
	}
	return total;
}

/**
 * The gateway: the one place the Phase 0 pieces compose into a live streaming chat turn.
 *
 * Order: resolve model -> build tool context/toolset -> load history -> reserve quota
 * (platform only) -> run inside the ALS correlation context -> `streamText` -> return the UI
 * message stream, persisting the finished turn and settling the reservation as it completes.
 *
 * SETTLEMENT (platform turns only — BYOK never reserves, so never settles). Every one of
 * `streamText`'s three MUTUALLY-EXCLUSIVE terminal callbacks settles the reservation, so a turn
 * that ends any way releases its held ceiling promptly instead of waiting on the 10-minute
 * orphan sweeper (an aborted turn holding its full request ceiling is the common case — the user
 * hitting "stop" — and on a non-resetting $1 default limit a few of those can transiently 429 a
 * legitimate user):
 *   - `onEnd`   (success): price the aggregate `usage` and settle the exact actual.
 *   - `onAbort` (user "stop" / signal): price the SUM of the finished `steps`' usage — the
 *                partial actually spent — never the full ceiling.
 *   - `onError` (stream/provider failure): `{ error }` carries no usage, so settle `null`;
 *                `settle()` coalesces null to the full ceiling (fail-safe — bill the worst case).
 * These three are terminal and mutually exclusive, so settle fires at most once per turn; a
 * `settled` latch makes that exactly-once regardless of any SDK edge, because `settle()` is
 * deliberately NOT idempotent on its spend leg and double-settling double-bills. The persist
 * happens separately, in `toUIMessageStreamResponse`'s own `onEnd`. (`onEnd`/`onAbort`/`onError`
 * are the current, non-deprecated names — `onFinish` is a deprecated alias.)
 */
export async function streamChatTurn(
	args: {
		session: { user: { id: string } };
		chatId: string;
		incoming: UIMessage;
		selector: ModelSelector;
		abortSignal?: AbortSignal;
	},
	deps: Deps = DEFAULT_DEPS
): Promise<Response> {
	const userId = args.session.user.id;
	const requestId = randomUUID();

	const resolved = await deps.resolveModel(userId, args.selector);
	const toolCtx = await createToolCtx(args.session, 'chat');
	const tools = toAiSdkTools(buildToolset(toolCtx), toolCtx);

	const prior = await deps.loadTurnHistory(args.chatId, userId);
	const uiMessages: UIMessage[] = [...prior, args.incoming];

	// BYOK bypasses platform quota entirely — and nothing else (same guardrails, same tools).
	let reservation: Reservation | null = null;
	if (!resolved.byok) {
		const ceiling = estimateRequestCeilingNanoUsd(resolved.resolvedModel, ESTIMATED_INPUT_TOKENS);
		reservation = await deps.reserve(userId, ceiling, requestId);
	}

	return runWithAiContext(
		{
			byok: resolved.byok,
			chatId: args.chatId,
			functionId: 'chat.turn',
			requestId,
			reservationId: reservation?.id,
			resolvedModel: resolved.resolvedModel,
			surface: 'CHAT',
			userId
		},
		async () => {
			// Exactly-once settle across the three mutually-exclusive terminal callbacks below.
			// BYOK turns hold no reservation, so this is a no-op for them.
			let settled = false;
			const settleOnce = async (actual: bigint | null): Promise<void> => {
				if (reservation === null || settled) return;
				settled = true;
				await deps.settle(reservation, actual);
			};

			const result = streamText({
				abortSignal: args.abortSignal,
				instructions: PORTFOLIO_ANALYST.text,
				messages: await convertToModelMessages(uiMessages),
				model: resolved.model,
				onAbort: async ({ steps }) => {
					// Partial spend actually incurred before the abort — never the full ceiling.
					await settleOnce(price(resolved.resolvedModel, sumStepUsage(steps))?.nanoUsd ?? null);
				},
				onEnd: async ({ usage }) => {
					await settleOnce(price(resolved.resolvedModel, toTokenUsage(usage))?.nanoUsd ?? null);
				},
				onError: async () => {
					// The error event exposes no usage; null => full-ceiling fail-safe in settle().
					await settleOnce(null);
				},
				stopWhen: isStepCount(MAX_STEPS),
				// recordInputs/recordOutputs MUST both be false and inline — v7 defaults both to
				// true, which would write this user's portfolio/transactions into the telemetry
				// sink. Enforced build-wide by telemetry-privacy.ts's TIER-0 BUILD GATE.
				telemetry: { functionId: 'chat.turn', recordInputs: false, recordOutputs: false },
				tools
			});

			return result.toUIMessageStreamResponse({
				onEnd: async ({ messages }) => {
					await deps.saveTurn({ chatId: args.chatId, messages, userId });
				},
				originalMessages: uiMessages
			});
		}
	);
}

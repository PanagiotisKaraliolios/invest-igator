import { randomUUID } from 'node:crypto';
import { convertToModelMessages, isStepCount, streamText, type UIMessage } from 'ai';
import { runWithAiContext } from '@/server/ai/context';
import { price } from '@/server/ai/pricing/price';
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
 * The gateway: the one place the Phase 0 pieces compose into a live streaming chat turn.
 *
 * Order: resolve model -> build tool context/toolset -> load history -> reserve quota
 * (platform only) -> run inside the ALS correlation context -> `streamText` -> return the UI
 * message stream, persisting the finished turn and settling the reservation as it completes.
 *
 * Settle/persist happen in `streamText`'s and `toUIMessageStreamResponse`'s `onEnd` callbacks
 * (the current, non-deprecated names — `onFinish` is an alias for both, kept only for
 * backwards compatibility per the v7 `.d.ts`). Settling is EXACTLY ONCE and ONLY when a
 * reservation exists (platform turns only — BYOK never reserves and never settles). No
 * error-path settle: a crash or client abort before `onEnd` fires leaves the reservation
 * unclaimed, and `sweepOrphanedReservations` reclaims its ceiling after `ORPHAN_AGE_MS` — the
 * same crash backstop every other reservation in the system already relies on. An additional
 * `finally`-based best-effort settle here would risk running concurrently with `onEnd`'s
 * success settle on some abort/finish race and double-billing, which is worse than the bounded,
 * already-covered delay in reclaiming an unused ceiling.
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
			const result = streamText({
				abortSignal: args.abortSignal,
				instructions: PORTFOLIO_ANALYST.text,
				messages: await convertToModelMessages(uiMessages),
				model: resolved.model,
				onEnd: async ({ usage }) => {
					if (reservation !== null) {
						const priced = price(resolved.resolvedModel, toTokenUsage(usage));
						await deps.settle(reservation, priced?.nanoUsd ?? null);
					}
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

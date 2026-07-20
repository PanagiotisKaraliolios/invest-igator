import { type LanguageModel, type LanguageModelMiddleware, wrapLanguageModel } from 'ai';

/**
 * Hard ceiling on output tokens FOR A SINGLE PROVIDER CALL — NOT for a whole `generateText`/
 * `streamText` REQUEST. Without a forced ceiling the per-call quota reservation (Task 8) is a
 * guess, and "reserve 1K output tokens, model returns 8K" is the classic bypass this closes.
 *
 * It does NOT bound a request that uses tool-calling with `stopWhen`: one request can issue up
 * to MAX_STEPS provider calls, each independently clamped to MAX_OUTPUT_TOKENS here — a worst
 * case of `MAX_STEPS * MAX_OUTPUT_TOKENS` output tokens for a single request. Task 8's quota
 * reservation MUST account for that — reserve `estimatedInputTokens + MAX_STEPS * MAX_OUTPUT_TOKENS`
 * (or cap the step count and reserve accordingly). Reserving a single MAX_OUTPUT_TOKENS per
 * REQUEST is the exact same "reserve 1K, model returns 8K" bypass this ceiling exists to close,
 * one level up.
 */
export const MAX_OUTPUT_TOKENS = 4096;

/**
 * Upper bound on the number of provider calls (`stopWhen` steps) a single `generateText`/
 * `streamText` request may issue. Tasks 7/8 must read the step cap from here — one named
 * constant — rather than hard-coding their own number, and must size any quota reservation
 * off both this and MAX_OUTPUT_TOKENS (see the comment above): a per-call bound alone does not
 * bound a request.
 */
export const MAX_STEPS = 8;

/**
 * Hard ceiling on how many tokens a SINGLE tool-call result may contribute once it is
 * serialized back into the conversation. Tool results are appended to the conversation and
 * RE-SENT AS INPUT on every subsequent step — they are exactly as dangerous to quota sizing as
 * model output, but the request-level ceiling in `quota.ts` (`estimateRequestCeilingNanoUsd`)
 * only bounds growth correctly if this cap is actually enforced by whatever appends tool
 * results to the conversation (Task 10). If a tool result is allowed to exceed this, the quota
 * reservation for the whole request is UNSOUND — the actual cost of resending an oversized
 * result on every remaining step can exceed the reserved ceiling.
 *
 * 8192 tokens. Tool results are JSON dominated by full-precision doubles, cuid ids and ISO
 * dates — content that BPE-tokenizes at ~2-2.8 chars/token, NOT the ~4 chars/token rule of
 * thumb that holds for English prose (measured against the gpt-4o/o200k_base encoding; see
 * `result-bounds.ts`'s `CHARS_PER_TOKEN`, which this token ceiling is enforced through). At the
 * conservative 2 chars/token that constant budgets on, this is roughly a 16 KB character budget
 * per result — small enough that `MAX_STEPS` of them can't quietly blow through a reservation.
 * Task 10 MUST truncate (or paginate/summarize) any tool result larger than this before it is
 * appended to the conversation.
 */
export const MAX_TOOL_RESULT_TOKENS = 8192;

export function clampMaxOutputTokens(requested: number | undefined): number {
	if (requested === undefined || !Number.isFinite(requested) || requested <= 0) {
		return MAX_OUTPUT_TOKENS;
	}
	return Math.min(Math.trunc(requested), MAX_OUTPUT_TOKENS);
}

/**
 * The one guardrail. Attached at registry level (every platform call passes through it)
 * and to every BYOK model via `applyGuardrails`.
 *
 * All Azure GPT-5.x models are reasoning models: they return HTTP 400 on temperature,
 * top_p, top_k, presence_penalty, frequency_penalty and seed. The rest-destructure REMOVES
 * those keys rather than setting them to undefined.
 *
 * These are stripped for EVERY provider, not just Azure — a BYOK Anthropic/Google model
 * would happily accept temperature, but a per-provider strip list is a second implementation
 * and therefore a second thing that can be wrong. Losing sampling knobs is not a product
 * requirement we have; a 400 in production is.
 */
const guardrailsImpl: LanguageModelMiddleware = {
	transformParams: async ({ params }) => {
		const {
			temperature: _temperature,
			topP: _topP,
			topK: _topK,
			presencePenalty: _presencePenalty,
			frequencyPenalty: _frequencyPenalty,
			seed: _seed,
			...rest
		} = params;

		return { ...rest, maxOutputTokens: clampMaxOutputTokens(params.maxOutputTokens) };
	}
};

/**
 * Frozen: `guardrails.transformParams = somethingElse` from ANY importing module must throw,
 * not silently disarm every call site that shares this object (ESM modules run in strict
 * mode, so assigning to a frozen own-property throws a TypeError instead of a silent no-op).
 */
export const guardrails: LanguageModelMiddleware = Object.freeze(guardrailsImpl);

/**
 * THE guardrail stack. The platform registry and every BYOK model are wrapped with this
 * exact array, so there is exactly one guardrail implementation and BYOK cannot skip it.
 *
 * Frozen for the same reason as `guardrails` above: `GUARDRAIL_STACK.length = 0` or
 * `GUARDRAIL_STACK.push(...)` from any module must throw, not quietly empty/grow the array
 * every consumer (registry.ts, applyGuardrails) shares by reference.
 */
export const GUARDRAIL_STACK: LanguageModelMiddleware[] = Object.freeze([guardrails]) as LanguageModelMiddleware[];

export type WrappableModel = Parameters<typeof wrapLanguageModel>[0]['model'];

/**
 * An UNGUARDED provider model, wrapped in a shape that is NOT a `LanguageModel`. Passing this
 * straight to `generateText`/`streamText` as `model:` fails to typecheck — it has none of
 * `LanguageModel`'s required members (`specificationVersion`, `doGenerate`, ...).
 * `applyGuardrails()` is the only function that unwraps it. `buildByokModel` (resolve-model.ts)
 * returns this instead of a bare `WrappableModel` so "callers MUST wrap it with
 * applyGuardrails()" is a compiler-enforced invariant, not just a doc comment.
 */
export type Unguarded = { readonly unguardedModel: WrappableModel };

/** The only way to produce an `Unguarded` value — keeps the marking in one place. */
export function markUnguarded(model: WrappableModel): Unguarded {
	return { unguardedModel: model };
}

/** Wraps a per-request BYOK model in the same guardrail stack the registry uses. */
export function applyGuardrails(model: WrappableModel | Unguarded): LanguageModel {
	const raw: WrappableModel = 'unguardedModel' in model ? model.unguardedModel : model;
	return wrapLanguageModel({ middleware: GUARDRAIL_STACK, model: raw });
}

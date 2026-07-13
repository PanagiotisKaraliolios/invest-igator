import { type LanguageModel, type LanguageModelMiddleware, wrapLanguageModel } from 'ai';

/**
 * Hard ceiling on output tokens. The quota reservation (Task 8) reserves
 * `estimatedInputTokens + maxOutputTokens` — without a forced ceiling that number
 * is a guess, and "reserve 1K output tokens, model returns 8K" is the classic bypass.
 */
export const MAX_OUTPUT_TOKENS = 4096;

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
export const guardrails: LanguageModelMiddleware = {
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
 * THE guardrail stack. The platform registry and every BYOK model are wrapped with this
 * exact array, so there is exactly one guardrail implementation and BYOK cannot skip it.
 */
export const GUARDRAIL_STACK: LanguageModelMiddleware[] = [guardrails];

export type WrappableModel = Parameters<typeof wrapLanguageModel>[0]['model'];

/** Wraps a per-request BYOK model in the same guardrail stack the registry uses. */
export function applyGuardrails(model: WrappableModel): LanguageModel {
	return wrapLanguageModel({ middleware: GUARDRAIL_STACK, model });
}

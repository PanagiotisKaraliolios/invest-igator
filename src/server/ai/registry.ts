import { createAzure } from '@ai-sdk/azure';
import { createProviderRegistry, type LanguageModel } from 'ai';

import { env } from '@/env';
import { GUARDRAIL_STACK } from '@/server/ai/guardrails';

// The locked contract requires `guardrails` to be importable from '@/server/ai/registry'.
// It LIVES in ./guardrails so that the guardrail tests need no environment at all.
export {
	applyGuardrails,
	clampMaxOutputTokens,
	GUARDRAIL_STACK,
	guardrails,
	MAX_OUTPUT_TOKENS,
	MAX_STEPS,
	type Unguarded,
	type WrappableModel
} from '@/server/ai/guardrails';

export type ResolvedModel = {
	model: LanguageModel;
	providerId: string;
	/** As reported by the SDK. For Azure this is the DEPLOYMENT NAME. */
	modelId: string;
	/** The real model, e.g. 'gpt-5.4-mini'. This is what we PRICE on — never modelId. */
	resolvedModel: string;
	byok: boolean;
};

/**
 * Built lazily, on first use — NOT at module scope. Importing this module must never throw,
 * and must never construct a provider, just because Azure isn't configured.
 *
 * `apiKey`/`resourceName` are passed in already-narrowed (non-undefined) by the sole caller,
 * `platformModel()`, after its configuration check — this function does no validation itself.
 * `apiVersion` defaults to the literal string 'v1'; never pass a date. The SDK builds
 * `https://{resourceName}.openai.azure.com/openai` and appends `/v1{path}` itself.
 */
let platformRegistry: ReturnType<typeof createProviderRegistry> | undefined;

function getPlatformRegistry(apiKey: string, resourceName: string): ReturnType<typeof createProviderRegistry> {
	platformRegistry ??= createProviderRegistry(
		{ azure: createAzure({ apiKey, resourceName }) },
		{ languageModelMiddleware: GUARDRAIL_STACK }
	);
	return platformRegistry;
}

/**
 * Throws a clear, actionable error — ONLY when someone actually asks for the platform model
 * and it isn't configured. Never throws at import time or env-parse time: a BYOK-only
 * deployment with zero Azure credentials is a valid app, not a crash. An app with no Azure
 * config simply has no platform LLM — a BYOK-only user still works fine.
 */
export function platformModel(): ResolvedModel {
	const apiKey = env.AZURE_OPENAI_API_KEY;
	const resourceName = env.AZURE_OPENAI_RESOURCE_NAME;
	const deployment = env.AZURE_OPENAI_CHAT_DEPLOYMENT;

	if (apiKey === undefined || resourceName === undefined || deployment === undefined) {
		throw new Error(
			'No platform LLM configured. Set AZURE_OPENAI_RESOURCE_NAME, AZURE_OPENAI_API_KEY ' +
				'and AZURE_OPENAI_CHAT_DEPLOYMENT, or add your own provider credentials (BYOK).'
		);
	}

	return {
		byok: false,
		// For Azure the deployment name IS the model id.
		model: getPlatformRegistry(apiKey, resourceName).languageModel(`azure:${deployment}`),
		modelId: deployment,
		providerId: 'azure',
		resolvedModel: env.AZURE_OPENAI_CHAT_MODEL
	};
}

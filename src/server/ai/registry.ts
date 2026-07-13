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
	type WrappableModel
} from '@/server/ai/guardrails';

/**
 * Platform provider. `apiKey` XOR `tokenProvider` — passing both throws at construction.
 * `apiVersion` defaults to the literal string 'v1'; never pass a date. The SDK builds
 * `https://{resourceName}.openai.azure.com/openai` and appends `/v1{path}` itself.
 */
export const registry = createProviderRegistry(
	{
		azure: createAzure({
			apiKey: env.AZURE_OPENAI_API_KEY,
			resourceName: env.AZURE_OPENAI_RESOURCE_NAME
		})
	},
	{ languageModelMiddleware: GUARDRAIL_STACK }
);

export type ResolvedModel = {
	model: LanguageModel;
	providerId: string;
	/** As reported by the SDK. For Azure this is the DEPLOYMENT NAME. */
	modelId: string;
	/** The real model, e.g. 'gpt-5.4-mini'. This is what we PRICE on — never modelId. */
	resolvedModel: string;
	byok: boolean;
};

export function platformModel(): ResolvedModel {
	return {
		byok: false,
		// For Azure the deployment name IS the model id.
		model: registry.languageModel(`azure:${env.AZURE_OPENAI_CHAT_DEPLOYMENT}`),
		modelId: env.AZURE_OPENAI_CHAT_DEPLOYMENT,
		providerId: 'azure',
		resolvedModel: env.AZURE_OPENAI_CHAT_MODEL
	};
}

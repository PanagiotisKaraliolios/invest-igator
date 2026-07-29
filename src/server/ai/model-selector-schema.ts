import { z } from 'zod';

/**
 * The ONE model-selector schema. Previously duplicated in the chat route and the ai-import
 * router, which meant a shape change had to be made in two places to stay in sync.
 *
 * `modelId` is OPTIONAL: omitted means "the credential's primary model", which is exactly the
 * pre-model-picker behaviour, so every existing client keeps working unchanged.
 */
export const modelSelectorSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('platform') }),
	z.object({
		kind: z.literal('byok'),
		modelId: z.string().min(1).max(120).optional(),
		provider: z.enum(['ANTHROPIC', 'AZURE', 'GOOGLE', 'OPENAI', 'OPENAI_COMPATIBLE'])
	})
]);

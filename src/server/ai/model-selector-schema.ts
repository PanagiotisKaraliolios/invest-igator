import { z } from 'zod';

/**
 * The single source of truth for which BYOK providers exist. `resolve-model.ts`'s
 * `ByokProvider` type (and its `PROVIDERS` runtime guard) derive from this array — previously
 * the 5-provider list was duplicated in both files and could silently drift out of sync.
 *
 * This module stays a zod-only leaf (no `@/server/db`, no other server imports), so
 * `resolve-model.ts` importing FROM here — never the reverse — cannot create an import cycle
 * or drag server-only code into a client-reachable module.
 */
export const BYOK_PROVIDERS = ['ANTHROPIC', 'AZURE', 'GOOGLE', 'OPENAI', 'OPENAI_COMPATIBLE'] as const;

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
		provider: z.enum(BYOK_PROVIDERS)
	})
]);

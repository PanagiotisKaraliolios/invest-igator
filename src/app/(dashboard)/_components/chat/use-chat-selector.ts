import type { ModelSelector } from '@/server/ai/resolve-model';

export type SelectorOption = { label: string; value: ModelSelector };

const PROVIDER_LABEL: Record<string, string> = {
	ANTHROPIC: 'Anthropic',
	AZURE: 'Azure',
	GOOGLE: 'Google',
	OPENAI: 'OpenAI',
	OPENAI_COMPATIBLE: 'Custom'
};

/**
 * Builds the model picker's option list: the platform model first (when configured), then one
 * entry PER ENABLED MODEL for each BYOK credential — one key commonly serves several models, so
 * naming only the provider would make Opus and Sonnet indistinguishable.
 *
 * AZURE contributes exactly one entry and never names a model: Azure routes on the deployment,
 * so a per-model choice there would change pricing without changing which model answers.
 *
 * `provider` is cast to `never` rather than the (unexported) `ByokProvider` union — the route
 * re-validates the selector server-side, so a stale value fails safely downstream.
 */
export function buildSelectorOptions(
	platformConfigured: boolean,
	creds: { defaultModelId?: string; enabledModelIds?: string[]; provider: string }[]
): SelectorOption[] {
	const opts: SelectorOption[] = [];
	if (platformConfigured) opts.push({ label: 'Platform', value: { kind: 'platform' } });

	for (const c of creds) {
		const providerLabel = PROVIDER_LABEL[c.provider] ?? c.provider;

		// Azure: a single, model-less entry (see the note above).
		if (c.provider === 'AZURE') {
			opts.push({
				label: c.defaultModelId ? `${providerLabel} · ${c.defaultModelId}` : providerLabel,
				value: { kind: 'byok', provider: c.provider as never }
			});
			continue;
		}

		// A credential saved before per-model selection has no enabled set — fall back to its
		// primary, and to a bare provider entry if even that is missing.
		const models = c.enabledModelIds?.length ? c.enabledModelIds : c.defaultModelId ? [c.defaultModelId] : [];

		if (models.length === 0) {
			opts.push({ label: providerLabel, value: { kind: 'byok', provider: c.provider as never } });
			continue;
		}

		for (const modelId of models) {
			opts.push({
				label: `${providerLabel} · ${modelId}`,
				value: { kind: 'byok', modelId, provider: c.provider as never }
			});
		}
	}
	return opts;
}

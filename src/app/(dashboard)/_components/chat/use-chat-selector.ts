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
 * entry per BYOK credential the user has saved. `creds` is deliberately loose (`{ provider }`)
 * so callers can pass `AiCredentialView[]` straight through without narrowing.
 *
 * `provider` is cast to `never` rather than the (unexported) `ByokProvider` union from
 * `resolve-model` — the route re-validates the selector server-side (Task 6), so a stale or
 * unrecognized provider string here fails safely downstream rather than needing a client-side
 * type guard.
 */
export function buildSelectorOptions(platformConfigured: boolean, creds: { provider: string }[]): SelectorOption[] {
	const opts: SelectorOption[] = [];
	if (platformConfigured) opts.push({ label: 'Platform', value: { kind: 'platform' } });
	for (const c of creds) {
		opts.push({
			label: `Your key: ${PROVIDER_LABEL[c.provider] ?? c.provider}`,
			value: { kind: 'byok', provider: c.provider as never }
		});
	}
	return opts;
}

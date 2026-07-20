import { describe, expect, mock, test } from 'bun:test';

/**
 * The user's actual situation: NO Azure credentials at all. This is a separate file (not a
 * second describe block in registry.test.ts) because `mock.module('@/env', ...)` must run
 * BEFORE the first import of './registry', and registry.test.ts already mocks '@/env' fully
 * configured for its own module instance.
 *
 * If this mock.module + import sequence throws, the whole file fails to load — which IS the
 * "importing registry.ts with no Azure env does not throw" assertion, made unskippable.
 */
mock.module('@/env', () => ({
	env: {
		AZURE_OPENAI_API_KEY: undefined,
		AZURE_OPENAI_CHAT_DEPLOYMENT: undefined,
		AZURE_OPENAI_CHAT_MODEL: 'gpt-5.4-mini',
		AZURE_OPENAI_RESOURCE_NAME: undefined
	}
}));

const { platformModel } = await import('./registry');

describe('platformModel — Azure entirely unconfigured', () => {
	// The regression this guards: Task 6 made the Azure env vars required so the app would
	// fail to BOOT without them. The fix moves that failure here — lazy, on first use, with
	// an actionable message — not to env parsing or module import.
	test('throws a clear, actionable error only when actually called', () => {
		expect(() => platformModel()).toThrow(
			'No platform LLM configured. Set AZURE_OPENAI_RESOURCE_NAME, AZURE_OPENAI_API_KEY and AZURE_OPENAI_CHAT_DEPLOYMENT, or add your own provider credentials (BYOK).'
		);
	});
});

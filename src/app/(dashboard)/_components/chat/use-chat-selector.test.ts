import { describe, expect, test } from 'bun:test';
import { buildSelectorOptions } from './use-chat-selector';

describe('buildSelectorOptions', () => {
	test('expands one credential into one option per enabled model', () => {
		const options = buildSelectorOptions(false, [
			{
				defaultModelId: 'claude-opus-5',
				enabledModelIds: ['claude-opus-5', 'claude-sonnet-5'],
				provider: 'ANTHROPIC'
			}
		]);

		expect(options).toEqual([
			{
				label: 'Anthropic · claude-opus-5',
				value: { kind: 'byok', modelId: 'claude-opus-5', provider: 'ANTHROPIC' }
			},
			{
				label: 'Anthropic · claude-sonnet-5',
				value: { kind: 'byok', modelId: 'claude-sonnet-5', provider: 'ANTHROPIC' }
			}
		]);
	});

	test('puts the platform option first when configured', () => {
		const options = buildSelectorOptions(true, []);
		expect(options).toEqual([{ label: 'Platform', value: { kind: 'platform' } }]);
	});

	test('AZURE gets ONE entry and never names a model', () => {
		const options = buildSelectorOptions(false, [
			{ defaultModelId: 'gpt-5.4-mini', enabledModelIds: ['gpt-5.4-mini', 'gpt-5'], provider: 'AZURE' }
		]);

		expect(options).toHaveLength(1);
		expect(options[0]?.value).toEqual({ kind: 'byok', provider: 'AZURE' });
	});

	test('a credential with no enabled set falls back to its primary model', () => {
		const options = buildSelectorOptions(false, [
			{ defaultModelId: 'gpt-5', enabledModelIds: [], provider: 'OPENAI' }
		]);

		// The label still names the model, but modelId is omitted from the emitted selector: an
		// EMPTY enabledModelIds means the route's `enabledModelIds.includes(modelId)` re-check would
		// 403 this as NO_SUCH_MODEL, so the option must round-trip as a bare provider selector.
		expect(options).toEqual([{ label: 'OpenAI · gpt-5', value: { kind: 'byok', provider: 'OPENAI' } }]);
	});

	test('a credential with neither still yields a usable provider-only entry', () => {
		const options = buildSelectorOptions(false, [{ provider: 'GOOGLE' }]);
		expect(options).toEqual([{ label: 'Google', value: { kind: 'byok', provider: 'GOOGLE' } }]);
	});
});

import { describe, expect, test } from 'bun:test';
import { buildSelectorOptions } from './use-chat-selector';

describe('selector options', () => {
	test('platform first when configured, then each byok provider', () => {
		const opts = buildSelectorOptions(true, [{ provider: 'ANTHROPIC' }, { provider: 'GOOGLE' }]);
		expect(opts.map((o) => o.label)).toEqual(['Platform', 'Your key: Anthropic', 'Your key: Google']);
	});

	test('omits platform when not configured', () => {
		const opts = buildSelectorOptions(false, [{ provider: 'ANTHROPIC' }]);
		expect(opts.map((o) => o.value.kind)).toEqual(['byok']);
	});

	test('empty when nothing available', () => {
		expect(buildSelectorOptions(false, [])).toEqual([]);
	});

	test('unknown provider falls back to the raw provider string', () => {
		const opts = buildSelectorOptions(false, [{ provider: 'MYSTERY' }]);
		expect(opts.map((o) => o.label)).toEqual(['Your key: MYSTERY']);
	});
});

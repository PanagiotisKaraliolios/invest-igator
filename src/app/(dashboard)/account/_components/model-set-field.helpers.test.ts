import { describe, expect, test } from 'bun:test';
import { computeModelItems } from './model-set-field.helpers';

describe('computeModelItems', () => {
	test('an empty or whitespace-only query leaves the fetched list unchanged', () => {
		expect(computeModelItems('', ['gpt-5.4', 'gpt-5.4-mini'], [])).toEqual(['gpt-5.4', 'gpt-5.4-mini']);
		expect(computeModelItems('   ', ['gpt-5.4', 'gpt-5.4-mini'], [])).toEqual(['gpt-5.4', 'gpt-5.4-mini']);
	});

	test('a query already present in fetched does not get appended again', () => {
		expect(computeModelItems('gpt-5.4', ['gpt-5.4', 'gpt-5.4-mini'], [])).toEqual(['gpt-5.4', 'gpt-5.4-mini']);
	});

	test('a query already present in enabled (but not fetched) does not get appended', () => {
		expect(computeModelItems('claude-opus-5', ['gpt-5.4'], ['claude-opus-5'])).toEqual(['gpt-5.4']);
	});

	test('a novel query is appended as the last item, trimmed', () => {
		expect(computeModelItems('  my-custom-model  ', ['gpt-5.4', 'gpt-5.4-mini'], ['claude-opus-5'])).toEqual([
			'gpt-5.4',
			'gpt-5.4-mini',
			'my-custom-model'
		]);
	});
});

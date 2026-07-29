import { describe, expect, test } from 'bun:test';
import { pickMessage } from './symbol-picker.helpers';

describe('pickMessage', () => {
	test('names the exact ticker so the model does not have to re-resolve it', () => {
		expect(pickMessage('VUAA.L')).toBe('Use VUAA.L');
	});

	test('trims surrounding whitespace', () => {
		expect(pickMessage('  VUAA.DE  ')).toBe('Use VUAA.DE');
	});
});

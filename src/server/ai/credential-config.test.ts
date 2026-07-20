import { describe, expect, test } from 'bun:test';
import { isDateApiVersion, maskHint, normalizeBaseUrl, normalizeResourceName } from './credential-config';

describe('maskHint', () => {
	test('shows only the last four characters', () => {
		expect(maskHint('sk-proj-abcdefgh1234')).toBe('••••1234');
	});

	test('reveals nothing for a short secret', () => {
		expect(maskHint('abc')).toBe('••••');
		expect(maskHint('')).toBe('••••');
	});

	test('never contains the secret', () => {
		const secret = 'sk-live-supersecret-9999';
		expect(maskHint(secret)).not.toContain('supersecret');
	});
});

describe('normalizeBaseUrl — the /v1/v1 404 trap', () => {
	test('strips a trailing /v1, because the SDK appends /v1{path} itself', () => {
		expect(normalizeBaseUrl('https://x.openai.azure.com/openai/v1')).toBe('https://x.openai.azure.com/openai');
	});

	test('strips a trailing slash', () => {
		expect(normalizeBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com');
	});

	test('trims whitespace', () => {
		expect(normalizeBaseUrl('  https://api.example.com  ')).toBe('https://api.example.com');
	});

	test('leaves a clean base URL alone', () => {
		expect(normalizeBaseUrl('https://api.example.com/openai')).toBe('https://api.example.com/openai');
	});
});

describe('normalizeResourceName — a resource name is NOT a URL', () => {
	test('accepts a bare resource name', () => {
		expect(normalizeResourceName('my-resource')).toBe('my-resource');
	});

	test('recovers the resource name from a pasted Azure endpoint', () => {
		expect(normalizeResourceName('https://my-resource.openai.azure.com/')).toBe('my-resource');
	});

	test('recovers it from the cognitiveservices host too', () => {
		expect(normalizeResourceName('https://my-resource.cognitiveservices.azure.com')).toBe('my-resource');
	});

	test('trims', () => {
		expect(normalizeResourceName('  my-resource ')).toBe('my-resource');
	});
});

describe('isDateApiVersion — apiVersion defaults to the literal string v1, never a date', () => {
	test('flags a date-shaped version', () => {
		expect(isDateApiVersion('2024-10-21')).toBe(true);
		expect(isDateApiVersion('2025-04-01-preview')).toBe(true);
	});

	test('accepts v1', () => {
		expect(isDateApiVersion('v1')).toBe(false);
	});
});

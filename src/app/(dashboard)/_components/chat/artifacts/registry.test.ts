import { describe, expect, test } from 'bun:test';
import { ALL_TOOLS } from '@/server/ai/tools/registry';
import { ARTIFACT_RENDERERS } from './registry';

describe('artifact registry', () => {
	test('every Phase 0 tool name has a renderer', () => {
		for (const tool of ALL_TOOLS) {
			expect(typeof ARTIFACT_RENDERERS[tool.name]).toBe('function');
		}
	});

	test('renderer keys are canonical dot names (no underscores)', () => {
		for (const key of Object.keys(ARTIFACT_RENDERERS)) {
			expect(key.includes('_')).toBe(false);
			expect(key.includes('.')).toBe(true);
		}
	});
});

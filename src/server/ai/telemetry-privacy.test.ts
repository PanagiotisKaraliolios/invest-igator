import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { findUnsafeTelemetryCallSites, scanSourceTree } from './telemetry-privacy';

describe('findUnsafeTelemetryCallSites', () => {
	test('a compliant call site produces no violations', () => {
		const src = "telemetry: { functionId: 'chat.turn', recordInputs: false, recordOutputs: false }";
		expect(findUnsafeTelemetryCallSites(src, 'x.ts')).toEqual([]);
	});

	test('a compliant call site with a NESTED object still produces no violations', () => {
		// The naive `\{[^{}]*\}` regex cannot match this literal and reports a bogus violation.
		const src =
			"telemetry: { functionId: 'chat.turn', metadata: { tier: 'free' }, recordInputs: false, recordOutputs: false }";
		expect(findUnsafeTelemetryCallSites(src, 'x.ts')).toEqual([]);
	});

	test('the word telemetry in a comment or a string is not a call site', () => {
		expect(findUnsafeTelemetryCallSites('// telemetry: we record no inputs\n', 'x.ts')).toEqual([]);
		expect(findUnsafeTelemetryCallSites('/* telemetry: nope */', 'x.ts')).toEqual([]);
		expect(findUnsafeTelemetryCallSites("const s = 'telemetry: x';", 'x.ts')).toEqual([]);
	});

	test('a call site missing recordInputs is a violation — v7 DEFAULTS IT TO TRUE', () => {
		const src = "telemetry: { functionId: 'chat.turn', recordOutputs: false }";
		const v = findUnsafeTelemetryCallSites(src, 'x.ts');
		expect(v.length).toBe(1);
		expect(v[0]).toContain('recordInputs: false');
	});

	test('a call site missing recordOutputs is a violation', () => {
		const src = "telemetry: { functionId: 'chat.turn', recordInputs: false }";
		const v = findUnsafeTelemetryCallSites(src, 'x.ts');
		expect(v.length).toBe(1);
		expect(v[0]).toContain('recordOutputs: false');
	});

	test('a bare `telemetry: { functionId }` is a violation on both counts', () => {
		expect(findUnsafeTelemetryCallSites("telemetry: { functionId: 'chat.turn' }", 'x.ts').length).toBe(2);
	});

	test('hiding the options behind a variable does not evade the check', () => {
		const v = findUnsafeTelemetryCallSites('telemetry: TELEMETRY_OPTS', 'x.ts');
		expect(v.length).toBe(1);
		expect(v[0]).toContain('inline object literal');
	});

	test('a spread does not evade the check', () => {
		const v = findUnsafeTelemetryCallSites("telemetry: { ...BASE, functionId: 'x' }", 'x.ts');
		expect(v.length).toBe(2);
	});

	test('recordInputs: true is a violation, not a pass', () => {
		const src = "telemetry: { functionId: 'x', recordInputs: true, recordOutputs: false }";
		expect(findUnsafeTelemetryCallSites(src, 'x.ts').length).toBe(1);
	});
});

describe('TIER-0 BUILD GATE', () => {
	test('no telemetry call site anywhere in src/ records the user portfolio', () => {
		const violations = scanSourceTree(path.join(process.cwd(), 'src'));
		expect(violations).toEqual([]);
	});
});

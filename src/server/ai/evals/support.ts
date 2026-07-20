import type { LanguageModelV4FinishReason, LanguageModelV4Usage } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';

/**
 * NOTE on scope, vs. an earlier draft of this harness:
 *
 * 1. No `scanTelemetryCallSites` here. `src/server/ai/telemetry-privacy.ts`
 *    (`scanSourceTree` / `findUnsafeTelemetryCallSites`) already does that job — properly, with
 *    brace-balanced parsing (a naive `telemetry:\s*\{[^}]*\}` regex breaks on the very first
 *    nested object literal, e.g. `metadata: { tier: 'free' }`) — and `telemetry-privacy.test.ts`
 *    already gates it under `describe('TIER-0 BUILD GATE', ...)`, already part of
 *    `bun test --isolate src`. A second scanner here would be a strictly worse duplicate.
 *
 * 2. No `assertNeverSerialises` here either, and deliberately no `import { expect } from
 *    'bun:test'` in this file. Two reasons, not one:
 *      - `tsconfig.json` excludes `src/**\/*.test.ts` from `tsc --noEmit` (bun's own type
 *        stripping covers those at test-run time instead) but does NOT exclude plain `.ts`
 *        helper modules — so a non-test file importing `bun:test` fails the real
 *        `bun run typecheck` gate, it is not merely the well-known IDE false positive that
 *        only affects `*.test.ts` files.
 *      - `crypto.test.ts` already asserts `Secret`/`seal`/`open` non-serialisability exhaustively
 *        (toString/toJSON/util.inspect, nested JSON.stringify, own-enumerable-property checks,
 *        structuredClone) — a second, differently-shaped nested-object test here would exercise
 *        the exact same mechanism (`Secret#toJSON`), not a new one.
 */

/** The subset of provider call options a Tier-0 eval ever asserts on. */
export type RecordedParams = {
	frequencyPenalty?: number;
	maxOutputTokens?: number;
	presencePenalty?: number;
	seed?: number;
	temperature?: number;
	topK?: number;
	topP?: number;
};

export type RecordingModel = {
	callCount: () => number;
	lastParams: () => RecordedParams | null;
	model: MockLanguageModelV4;
};

/**
 * The PROVIDER-SPEC usage shape (`LanguageModelV4Usage`) — what `doGenerate` RETURNS.
 * Token counts are NESTED and there is no `totalTokens`; the SDK computes the flat facade
 * shape (`LanguageModelUsage`, with `inputTokenDetails`/`outputTokenDetails`) from this and
 * hands THAT back on `result.usage` and on the telemetry event.
 *
 * These are two different types — writing the facade shape here is a TS2322. Typed explicitly
 * so the literals do not widen (an inline `async () => ({...})` widens `unified: 'stop'` to
 * `string` and fails to assign).
 */
const MOCK_USAGE: LanguageModelV4Usage = {
	inputTokens: { cacheRead: undefined, cacheWrite: undefined, noCache: 11, total: 11 },
	outputTokens: { reasoning: undefined, text: 7, total: 7 }
};

const MOCK_FINISH: LanguageModelV4FinishReason = { raw: 'stop', unified: 'stop' };

/**
 * A MockLanguageModelV4 that records the params it was actually handed.
 * This is how we prove the guardrail middleware ran — we look at what reached the
 * provider, not at what the middleware claims to have done.
 */
export function recordingModel(): RecordingModel {
	let params: RecordedParams | null = null;
	let calls = 0;
	const model = new MockLanguageModelV4({
		doGenerate: async (options) => {
			calls += 1;
			params = options as unknown as RecordedParams;
			return {
				content: [{ text: 'ok', type: 'text' as const }],
				finishReason: MOCK_FINISH,
				usage: MOCK_USAGE,
				warnings: []
			};
		}
	});
	return { callCount: () => calls, lastParams: () => params, model };
}

/** A MockLanguageModelV4 whose provider call always throws — exercises the onError path. */
export function throwingModel(message = 'content_filter'): MockLanguageModelV4 {
	return new MockLanguageModelV4({
		doGenerate: async () => {
			throw new Error(message);
		}
	});
}

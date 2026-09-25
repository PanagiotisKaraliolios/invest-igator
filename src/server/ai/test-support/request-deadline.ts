import { MockLanguageModelV4 } from 'ai/test';

/**
 * Test-only. `requestAbortSignal`'s deadline is `AbortSignal.timeout(REQUEST_TIMEOUT_MS)` — five
 * minutes of real wall clock. This swaps `AbortSignal.timeout` for deadlines the test fires by
 * hand, recording the duration every caller asked for, so "the call is aborted once
 * `REQUEST_TIMEOUT_MS` elapses" is proven end to end (real helper, real call site, real AI SDK,
 * mock provider) in milliseconds. It replaces a global: `restore()` it in a `finally`.
 *
 * A plain reassignment rather than `bun:test`'s `spyOn`: this file is not a `*.test.ts`, so
 * `tsc` checks it, and the project's `types` do not include `bun:test`.
 */
export function fakeRequestDeadlines(): {
	fireAll: () => void;
	requestedMs: () => number[];
	restore: () => void;
} {
	const realTimeout = AbortSignal.timeout;
	const deadlines: Array<{ controller: AbortController; ms: number }> = [];
	AbortSignal.timeout = (ms: number): AbortSignal => {
		const controller = new AbortController();
		deadlines.push({ controller, ms });
		return controller.signal;
	};
	return {
		/** Elapses every deadline created so far, with the same `TimeoutError` the real one uses. */
		fireAll: () => {
			for (const { controller } of deadlines) {
				controller.abort(new DOMException('The operation timed out.', 'TimeoutError'));
			}
		},
		/** Every duration `AbortSignal.timeout` was asked for, in call order. */
		requestedMs: () => deadlines.map(({ ms }) => ms),
		restore: () => {
			AbortSignal.timeout = realTimeout;
		}
	};
}

/**
 * A provider that accepts the call and then never answers — the failure `REQUEST_TIMEOUT_MS`
 * exists for. `doGenerate` and `doStream` settle ONLY when the call's `abortSignal` aborts,
 * rejecting with its `reason` the way a real `fetch` does. A call that arrives WITHOUT a signal
 * is the bug under test: it is rejected at once instead of hanging the test run, so the test's
 * own assertions fail fast with a readable diff rather than a test timeout.
 *
 * `entered` resolves once the provider call has started, so a test fires the deadline mid-call.
 * The signals each call received are on the mock's own `doGenerateCalls`/`doStreamCalls`.
 */
export function unansweredModel(): { entered: Promise<void>; model: MockLanguageModelV4 } {
	let markEntered: () => void = () => {};
	const entered = new Promise<void>((resolve) => {
		markEntered = resolve;
	});
	const hang = async ({ abortSignal }: { abortSignal?: AbortSignal }): Promise<never> => {
		markEntered();
		if (abortSignal === undefined) {
			throw new Error('the provider call received no abortSignal — nothing bounds how long it runs');
		}
		return await new Promise<never>((_, reject) => {
			if (abortSignal.aborted) reject(abortSignal.reason);
			abortSignal.addEventListener('abort', () => reject(abortSignal.reason), { once: true });
		});
	};
	return {
		entered,
		model: new MockLanguageModelV4({
			doGenerate: hang,
			doStream: hang,
			modelId: 'mock-unanswered',
			provider: 'mock'
		})
	};
}

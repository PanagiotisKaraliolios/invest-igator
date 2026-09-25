import { describe, expect, mock, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { blankNonCode, matchBraces } from './telemetry-privacy';
import { fakeRequestDeadlines } from './test-support/request-deadline';

/**
 * Hermetic. quota.ts's reserve/settle/sweep are DB-backed and run against a real Postgres in
 * `prisma/ai-quota.test.ts` (home of the `REQUEST_TIMEOUT_MS < ORPHAN_AGE_MS` assertion). What
 * lives here needs no database — `requestAbortSignal`, and the build gate that keeps every AI SDK
 * call site on it — so `@/server/db` is stubbed rather than connected.
 */
mock.module('@/server/db', () => ({ db: {} }));

const { REQUEST_TIMEOUT_MS, requestAbortSignal } = await import('./quota');

describe('requestAbortSignal', () => {
	test('always carries a REQUEST_TIMEOUT_MS deadline, and aborts with a TimeoutError once it elapses', () => {
		const deadlines = fakeRequestDeadlines();
		try {
			const signal = requestAbortSignal();
			// The spy is installed AFTER quota.ts loaded, so this also proves the deadline is built
			// per call — a module-scope signal would expire once, five minutes after boot, for everyone.
			expect(deadlines.requestedMs()).toEqual([REQUEST_TIMEOUT_MS]);
			expect(signal.aborted).toBe(false);

			deadlines.fireAll();

			expect(signal.aborted).toBe(true);
			expect((signal.reason as DOMException).name).toBe('TimeoutError');
		} finally {
			deadlines.restore();
		}
	});

	// The chat gateway's original gap: it passed only the route's `req.signal`, which never fires
	// while the client stays connected. The deadline must abort a request whose caller is still live.
	test('with a caller signal that never fires, the deadline still aborts it', () => {
		const deadlines = fakeRequestDeadlines();
		try {
			const caller = new AbortController();
			const signal = requestAbortSignal(caller.signal);
			expect(deadlines.requestedMs()).toEqual([REQUEST_TIMEOUT_MS]);

			deadlines.fireAll();

			expect(caller.signal.aborted).toBe(false);
			expect(signal.aborted).toBe(true);
			expect((signal.reason as DOMException).name).toBe('TimeoutError');
		} finally {
			deadlines.restore();
		}
	});

	test('the caller signal is combined, not replaced: the caller aborting aborts it with its own reason', () => {
		const caller = new AbortController();
		const signal = requestAbortSignal(caller.signal);
		expect(signal.aborted).toBe(false);

		caller.abort();

		expect(signal.aborted).toBe(true);
		expect((signal.reason as DOMException).name).toBe('AbortError');
	});
});

const AI_SDK_CALL = /(?<![\w$])(generateText|streamText|generateObject|streamObject)\s*\(/g;
const DEADLINE_OPTION = /(?<![\w$.])abortSignal\s*:\s*requestAbortSignal\s*\(/;

/**
 * Every AI SDK request call in `source`, and whether its options literal passes
 * `abortSignal: requestAbortSignal(...)`. The same heuristic scan as telemetry-privacy.ts's TIER-0
 * gate: comments and strings are blanked first (so prose that names `streamText(` is not a call),
 * and the options must be an inline object literal — options hidden behind a variable cannot be
 * verified, so they count as unbounded.
 */
function aiSdkCalls(source: string): Array<{ bounded: boolean; fn: string }> {
	const code = blankNonCode(source);
	const calls: Array<{ bounded: boolean; fn: string }> = [];
	for (const match of code.matchAll(AI_SDK_CALL)) {
		let cursor = match.index + match[0].length;
		while (/\s/.test(code[cursor] ?? '')) cursor += 1;
		const options = code[cursor] === '{' ? matchBraces(code, cursor) : null;
		calls.push({ bounded: options !== null && DEADLINE_OPTION.test(options), fn: match[1] ?? '' });
	}
	return calls;
}

/**
 * Non-test sources under `src/`, minus the live evals: they reserve no quota and run nightly
 * under their own job timeout, never on a user's request.
 */
function productionSources(srcDir: string): string[] {
	const evalsDir = path.join('server', 'ai', 'evals') + path.sep;
	return readdirSync(srcDir, { recursive: true })
		.map(String)
		.filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith(evalsDir))
		.map((f) => path.join(srcDir, f));
}

describe('aiSdkCalls', () => {
	test('a call bounded by requestAbortSignal is bounded, with or without a caller signal', () => {
		expect(aiSdkCalls('streamText({ abortSignal: requestAbortSignal(args.abortSignal), model })')).toEqual([
			{ bounded: true, fn: 'streamText' }
		]);
		expect(aiSdkCalls('await generateObject({\n\tabortSignal: requestAbortSignal(),\n\tmodel\n})')).toEqual([
			{ bounded: true, fn: 'generateObject' }
		]);
	});

	test('no abortSignal, a bare caller signal, or a hand-rolled timeout is unbounded', () => {
		expect(aiSdkCalls("generateText({ model, prompt: 'ping' })")).toEqual([{ bounded: false, fn: 'generateText' }]);
		// The chat gateway's shape before this gate existed.
		expect(aiSdkCalls('streamText({ abortSignal: args.abortSignal, model })')).toEqual([
			{ bounded: false, fn: 'streamText' }
		]);
		// Right deadline, wrong place: it drops the caller signal, and the rule stops living in one helper.
		expect(aiSdkCalls('streamObject({ abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), model })')).toEqual([
			{ bounded: false, fn: 'streamObject' }
		]);
	});

	test('options hidden behind a variable cannot be verified, so they are unbounded', () => {
		expect(aiSdkCalls('generateText(OPTIONS)')).toEqual([{ bounded: false, fn: 'generateText' }]);
	});

	test('a mention in a comment or a string, an import or a type position is not a call', () => {
		expect(aiSdkCalls('// streamText({ model }) would hang\n')).toEqual([]);
		expect(aiSdkCalls("const s = 'generateText({ model })';")).toEqual([]);
		expect(aiSdkCalls("import { generateText, streamText } from 'ai';")).toEqual([]);
		expect(aiSdkCalls('type P = Parameters<typeof generateText>[0];')).toEqual([]);
	});
});

describe('REQUEST_TIMEOUT_MS BUILD GATE', () => {
	test('every production AI SDK call in src/ passes abortSignal: requestAbortSignal(...)', () => {
		const srcDir = path.join(process.cwd(), 'src');
		const unbounded: string[] = [];
		const callers: string[] = [];
		for (const file of productionSources(srcDir)) {
			const calls = aiSdkCalls(readFileSync(file, 'utf8'));
			if (calls.length > 0) callers.push(path.relative(srcDir, file));
			for (const call of calls.filter((c) => !c.bounded)) {
				unbounded.push(
					`${path.relative(srcDir, file)}: \`${call.fn}(\` has no \`abortSignal: requestAbortSignal(...)\``
				);
			}
		}

		expect(unbounded).toEqual([]);
		// Not vacuous: the scan really reaches the call sites it exists to guard.
		expect(callers).toEqual(
			expect.arrayContaining([
				path.join('server', 'ai', 'chat', 'gateway.ts'),
				path.join('server', 'ai', 'import', 'map-columns.ts'),
				path.join('server', 'ai', 'probe.ts')
			])
		);
	});
});

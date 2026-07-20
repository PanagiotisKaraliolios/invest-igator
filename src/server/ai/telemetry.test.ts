import { beforeEach, describe, expect, test } from 'bun:test';
import type { LanguageModelV4Usage } from '@ai-sdk/provider';
import { generateText, type LanguageModelUsage, registerTelemetry, tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';
import { type AiCallContext, runWithAiContext } from './context';
import { Secret } from './crypto';
import {
	type AiCallRow,
	type AiToolCallRow,
	buildAiCallRow,
	classifyOutcome,
	createLedgerTelemetry,
	type LedgerSink,
	registerAiTelemetryOnce,
	safeErrorMessage,
	scrubSecrets,
	toTokenUsage,
	toUsageColumns
} from './telemetry';

const ctx = (over: Partial<AiCallContext> = {}): AiCallContext => ({
	byok: false,
	functionId: 'eval.telemetry',
	requestId: 'req-1',
	resolvedModel: 'gpt-5.4-mini',
	surface: 'EVAL',
	userId: 'user-1',
	...over
});

// LanguageModelUsage: every key is REQUIRED but typed `| undefined`. A mock written with
// `?`-optional keys does not typecheck. Spell all of them out, and annotate the return type so a
// drifted SDK shape fails loudly here.
const usage = (
	inputTokens: number,
	outputTokens: number,
	cache: { read?: number; write?: number } = {}
): LanguageModelUsage => ({
	inputTokenDetails: {
		cacheReadTokens: cache.read,
		cacheWriteTokens: cache.write,
		noCacheTokens: undefined
	},
	inputTokens,
	outputTokenDetails: { reasoningTokens: undefined, textTokens: undefined },
	outputTokens,
	totalTokens: inputTokens + outputTokens
});

/**
 * `MockLanguageModelV4.doGenerate` implements the PROVIDER-SPEC interface (`@ai-sdk/provider`),
 * not the facade `LanguageModelUsage` the SDK later derives from it (via `asLanguageModelUsage`,
 * which reads `usage.inputTokens.total`). Feeding it the flat facade shape silently produces
 * `{ inputTokens: undefined, ... }` on the telemetry event — no crash, just a null column. Two
 * different types; this is the one `doGenerate()` mocks must return.
 */
const mockUsage = (
	inputTokens: number,
	outputTokens: number,
	cache: { read?: number; write?: number } = {}
): LanguageModelV4Usage => ({
	inputTokens: { cacheRead: cache.read, cacheWrite: cache.write, noCache: undefined, total: inputTokens },
	outputTokens: { reasoning: undefined, text: undefined, total: outputTokens }
});

/** AiCallRow.costNanoUsd is a bigint — plain JSON.stringify THROWS on it. */
const dump = (v: unknown): string => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

/** Mirrors telemetry.ts's private REDACTED constant — kept independent so a rename there is visible here. */
const REDACTED_MARKER = '[redacted]';

// ONE global registration for the whole file. `registerTelemetry` pushes onto a global array; a
// second call would make every later generateText write into every earlier sink.
let calls: AiCallRow[] = [];
let tools: AiToolCallRow[] = [];
const routingSink: LedgerSink = {
	writeCall: async (row) => {
		calls.push(row);
	},
	writeToolCall: async (row) => {
		tools.push(row);
	}
};
registerTelemetry(createLedgerTelemetry(routingSink));

beforeEach(() => {
	calls = [];
	tools = [];
});

describe('scrubSecrets / safeErrorMessage — R8: secrets leak through error OBJECTS, not logs', () => {
	test('a provider error carrying the api-key header never reaches the row', () => {
		// This is the exact shape an @ai-sdk/* APICallError has: the request config is attached,
		// headers and all. JSON.stringify(err) here would publish a BYOK key to the database.
		const err = Object.assign(new Error('Bad Request'), {
			name: 'AI_APICallError',
			requestBodyValues: { messages: [{ content: 'my portfolio', role: 'user' }] },
			requestHeaders: { 'api-key': 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6' },
			statusCode: 400,
			url: 'https://acme.openai.azure.com/openai/v1/responses'
		});
		const out = safeErrorMessage(err);
		const serialised = dump(out);
		expect(serialised).not.toContain('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
		expect(serialised).not.toContain('my portfolio');
		expect(out.code).toBe('HTTP_400');
		expect(out.message).toBe('Bad Request');
	});

	test('a Secret interpolated into an error message is redacted, not exposed', () => {
		const secret = new Secret('sk-live-supersecret-byok-key');
		const out = safeErrorMessage(new Error(`auth failed for ${secret}`));
		expect(out.message).not.toContain('supersecret');
		expect(out.message).toContain('[redacted]');
	});

	// Gap: the test above interpolates a `Secret`, whose `toString()` ALREADY returns
	// '[redacted]' (crypto.ts) — the raw key never reaches `safeErrorMessage` at all, so that
	// test cannot catch a regression in the `message` field's OWN scrub. This is the actual
	// at-rest path: a self-hosted OPENAI_COMPATIBLE gateway that echoes a plaintext key in a
	// plain `Error#message` (no `Secret` involved anywhere) must still be scrubbed before the
	// value is persisted to `AiCall.errorMessage`.
	test('a raw credential in a bare Error#message (no Secret involved) is scrubbed, not persisted verbatim', () => {
		const err = new Error('auth failed for sk-live-9Zq3vB7nRt2LmXwK1pQfY6x');
		const out = safeErrorMessage(err);
		expect(out.message).not.toContain('sk-live-9Zq3vB7nRt2LmXwK1pQfY6x');
		expect(out.message).toContain(REDACTED_MARKER);
	});

	// Same gap, duck-typed: safeErrorMessage reads `e.message` off ANY object with a string
	// `message` property, not just `Error` instances (provider SDKs routinely throw plain
	// objects). The raw key must be scrubbed on that path too.
	test('a raw credential in a duck-typed (non-Error) object message is scrubbed the same way', () => {
		const err = { message: 'connection refused: token=sk-live-9Zq3vB7nRt2LmXwK1pQfY6x is invalid' };
		const out = safeErrorMessage(err);
		expect(out.message).not.toContain('sk-live-9Zq3vB7nRt2LmXwK1pQfY6x');
		expect(out.message).toContain(REDACTED_MARKER);
	});

	test('a raw key that slipped into the message text is scrubbed anyway', () => {
		expect(scrubSecrets('rejected: sk-abcdef0123456789 is invalid')).not.toContain('sk-abcdef0123456789');
		expect(scrubSecrets('api-key: a1b2c3d4e5f6a7b8')).not.toContain('a1b2c3d4e5f6a7b8');
	});

	// I1: `code` (and its `name` fallback) must get the same scrub-and-cap treatment as `message` —
	// the docstring's "scrub what survives" promise previously only applied to `message`.
	test('err.code is scrubbed, not persisted verbatim (I1)', () => {
		const err = Object.assign(new Error('rejected'), { code: 'invalid_key:sk-live-9Zq3vB7nRt2LmXwK1pQfY6' });
		const out = safeErrorMessage(err);
		expect(out.code).not.toContain('sk-live-9Zq3vB7nRt2LmXwK1pQfY6');
	});

	test('err.name is scrubbed when used as the code fallback (I1)', () => {
		const err = Object.assign(new Error('rejected'), { name: 'Err_sk-live-9Zq3vB7nRt2LmXwK1pQfY6' });
		const out = safeErrorMessage(err);
		expect(out.code).not.toContain('sk-live-9Zq3vB7nRt2LmXwK1pQfY6');
	});

	// I2: short/naturally-phrased credentials. OPENAI_COMPATIBLE is a first-class BYOK provider —
	// a user's self-hosted vLLM/LiteLLM gateway commonly echoes their own (short, self-chosen) key
	// back in plain, space-separated error text, not colon/equals-delimited.
	test('a short key after a space-separated "api-key" label is scrubbed (I2)', () => {
		expect(scrubSecrets('api-key abc123DEF456ghi rejected')).not.toContain('abc123DEF456ghi');
	});

	test('a naturally-phrased "API key" (with a space) label still triggers a scrub (I2)', () => {
		expect(scrubSecrets('Invalid API key: hunter2hunter2')).not.toContain('hunter2hunter2');
	});

	test('messages are hard-capped (I4)', () => {
		// Many short words joined by spaces: no run of 24+ token chars and no credential-shaped
		// substring, so nothing here matches any SECRET_PATTERN before the length cap runs — unlike
		// 'x'.repeat(5000), which the bare-token pattern alone collapses to '[redacted]' well before
		// the slice, letting a deleted cap hide behind it undetected.
		const longButNoTokens = 'lorem ipsum dolor sit amet '.repeat(200); // 5400 chars
		const scrubbed = scrubSecrets(longButNoTokens);
		expect(scrubbed).not.toContain(REDACTED_MARKER); // sanity: confirms no pattern fired
		expect(scrubbed.length).toBe(500);
	});
});

describe('classifyOutcome', () => {
	test('an Azure content-filter 400 is CONTENT_FILTERED with code content_filter, not HTTP_400', () => {
		const err = Object.assign(new Error('Bad Request'), {
			responseBody: '{"error":{"code":"content_filter","message":"response was filtered"}}',
			statusCode: 400
		});
		const c = classifyOutcome(err);
		expect(c.outcome).toBe('CONTENT_FILTERED');
		// The generic path would give HTTP_400 here and bury the reason. It must not.
		expect(c.code).toBe('content_filter');
	});

	test('the responseBody is used for classification but NEVER stored', () => {
		const err = Object.assign(new Error('Bad Request'), {
			responseBody: '{"error":{"code":"content_filter","prompt":"my portfolio is 90% NVDA"}}',
			statusCode: 400
		});
		expect(classifyOutcome(err).message).not.toContain('NVDA');
	});

	test('an abort is ABORTED', () => {
		expect(classifyOutcome(Object.assign(new Error('aborted'), { name: 'AbortError' })).outcome).toBe('ABORTED');
	});

	test('anything else is ERROR', () => {
		expect(classifyOutcome(new Error('socket hang up')).outcome).toBe('ERROR');
	});
});

describe('usage mapping — R3: every token leaf is `number | undefined`', () => {
	test('undefined usage maps to nulls, never to 0', () => {
		const cols = toUsageColumns(undefined);
		expect(cols.inputTokens).toBeNull();
		expect(cols.outputTokens).toBeNull();
		expect(cols.totalTokens).toBeNull();
		expect(toTokenUsage(undefined).inputTokens).toBeNull();
	});

	test('cache buckets are lifted out of inputTokenDetails', () => {
		const u = usage(100, 20, { read: 90 });
		expect(toTokenUsage(u).cacheReadTokens).toBe(90);
		expect(toUsageColumns(u).cacheReadTokens).toBe(90);
	});
});

describe('buildAiCallRow', () => {
	test('prices on ctx.resolvedModel, NOT on the Azure deployment name', () => {
		const row = buildAiCallRow({
			callId: 'c1',
			ctx: ctx(),
			errorCode: null,
			errorMessage: null,
			finishReason: 'stop',
			latencyMs: 12,
			modelId: 'my-prod-deployment', // the Azure deployment name — in no catalogue anywhere
			outcome: 'OK',
			provider: 'azure',
			responseId: 'r1',
			usage: usage(1000, 500)
		});
		expect(row.modelId).toBe('my-prod-deployment');
		expect(row.resolvedModel).toBe('gpt-5.4-mini');
		expect(row.pricingStatus).toBe('PRICED');
		expect(row.costNanoUsd).not.toBeNull();
		expect(row.costNanoUsd ?? 0n).toBeGreaterThan(0n);
	});

	test('an unknown model is UNKNOWN_MODEL with a NULL cost — never 0', () => {
		const row = buildAiCallRow({
			callId: null,
			ctx: ctx({ resolvedModel: 'gpt-9-imaginary' }),
			errorCode: null,
			errorMessage: null,
			finishReason: 'stop',
			latencyMs: 1,
			modelId: 'gpt-9-imaginary',
			outcome: 'OK',
			provider: 'openai',
			responseId: null,
			usage: usage(10, 10)
		});
		expect(row.pricingStatus).toBe('UNKNOWN_MODEL');
		expect(row.costNanoUsd).toBeNull();
	});

	test('a row with no usage (an error row) has a NULL cost, not 0', () => {
		const row = buildAiCallRow({
			callId: null,
			ctx: ctx(),
			errorCode: 'HTTP_500',
			errorMessage: 'boom',
			finishReason: null,
			latencyMs: 1,
			modelId: 'gpt-5.4-mini',
			outcome: 'ERROR',
			provider: 'openai',
			responseId: null,
			usage: undefined
		});
		expect(row.costNanoUsd).toBeNull();
		expect(row.inputTokens).toBeNull();
	});

	test('BYOK is billedTo USER', () => {
		const row = buildAiCallRow({
			callId: null,
			ctx: ctx({ byok: true }),
			errorCode: null,
			errorMessage: null,
			finishReason: 'stop',
			latencyMs: 1,
			modelId: 'gpt-5.4-mini',
			outcome: 'OK',
			provider: 'openai',
			responseId: null,
			usage: usage(10, 10)
		});
		expect(row.billedTo).toBe('USER');
	});
});

describe('the Telemetry integration', () => {
	test('a successful model call writes exactly one AiCall row, and no prompt text', async () => {
		await runWithAiContext(ctx({ requestId: 'req-ok' }), async () => {
			await generateText({
				instructions: 'you are a test',
				maxRetries: 0,
				model: new MockLanguageModelV4({
					doGenerate: async () => ({
						content: [{ text: 'ok', type: 'text' as const }],
						finishReason: { raw: undefined, unified: 'stop' as const },
						usage: mockUsage(1000, 500),
						warnings: []
					})
				}),
				prompt: 'my portfolio is 90% NVDA',
				telemetry: { functionId: 'eval.telemetry', recordInputs: false, recordOutputs: false }
			});
		});

		expect(calls.length).toBe(1);
		const row = calls[0];
		if (row === undefined) throw new Error('unreachable');
		expect(row.requestId).toBe('req-ok');
		expect(row.outcome).toBe('OK');
		expect(row.surface).toBe('EVAL');
		expect(row.resolvedModel).toBe('gpt-5.4-mini');
		expect(row.inputTokens).toBe(1000);
		expect(row.outputTokens).toBe(500);
		expect(row.costNanoUsd ?? 0n).toBeGreaterThan(0n);
		// TIER-0: the ledger row is metadata. The user's holdings must not be in it.
		expect(dump(row)).not.toContain('NVDA');
	});

	test('R4: a FAILED call still writes a row — onLanguageModelCallEnd never fires for it', async () => {
		await runWithAiContext(ctx({ requestId: 'req-err' }), async () => {
			await expect(
				generateText({
					instructions: 'you are a test',
					maxRetries: 0, // without this the SDK retries and we get three error rows
					model: new MockLanguageModelV4({
						// Explicit: MockLanguageModelV4's own default provider id is 'mock-provider',
						// not 'mock'. Named here so the assertion below proves the row captures the
						// SDK-reported provider (via onLanguageModelCallStart) rather than a guess.
						doGenerate: async () => {
							throw Object.assign(new Error('Bad Request'), {
								responseBody: '{"error":{"code":"content_filter"}}',
								statusCode: 400
							});
						},
						provider: 'mock'
					}),
					prompt: 'hello',
					telemetry: { functionId: 'eval.telemetry', recordInputs: false, recordOutputs: false }
				})
			).rejects.toThrow();
		});

		expect(calls.length).toBe(1);
		const row = calls[0];
		if (row === undefined) throw new Error('unreachable');
		expect(row.outcome).toBe('CONTENT_FILTERED');
		expect(row.errorCode).toBe('content_filter');
		expect(row.costNanoUsd).toBeNull();
		expect(row.provider).toBe('mock'); // captured by onLanguageModelCallStart, not invented
	});

	test('a failing TOOL writes an AiToolCall row with ok=false and a SCRUBBED message', async () => {
		await runWithAiContext(ctx({ requestId: 'req-tool' }), async () => {
			// The SDK may or may not rethrow a tool-execution error; the ledger row is what we assert.
			await generateText({
				instructions: 'you are a test',
				maxRetries: 0,
				model: new MockLanguageModelV4({
					doGenerate: async () => ({
						content: [{ input: '{}', toolCallId: 'tc-1', toolName: 'boom', type: 'tool-call' as const }],
						finishReason: { raw: undefined, unified: 'tool-calls' as const },
						usage: mockUsage(10, 5),
						warnings: []
					})
				}),
				prompt: 'hello',
				telemetry: { functionId: 'eval.telemetry', recordInputs: false, recordOutputs: false },
				tools: {
					boom: tool({
						description: 'always fails',
						execute: async () => {
							throw new Error('upstream rejected api-key: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
						},
						inputSchema: z.strictObject({})
					})
				}
			}).catch(() => undefined);
		});

		expect(tools.length).toBe(1);
		const row = tools[0];
		if (row === undefined) throw new Error('unreachable');
		expect(row.ok).toBe(false); // discriminated on toolOutput.type — there is NO event.success
		expect(row.toolName).toBe('boom');
		expect(row.requestId).toBe('req-tool');
		expect(row.inputHash).toBeNull();
		expect(row.errorMessage ?? '').not.toContain('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
	});

	// C1: a tool's error text can contain the user's own PORTFOLIO — positions, quantities, and a
	// broker account number — not just credentials. `scrubSecrets` alone does not catch this (it
	// targets credential shapes only), so the fix is to never store the free-form message at all.
	test('C1: a tool error containing the user portfolio never reaches the AiToolCall row', async () => {
		await runWithAiContext(ctx({ requestId: 'req-tool-portfolio' }), async () => {
			await generateText({
				instructions: 'you are a test',
				maxRetries: 0,
				model: new MockLanguageModelV4({
					doGenerate: async () => ({
						content: [{ input: '{}', toolCallId: 'tc-2', toolName: 'lot', type: 'tool-call' as const }],
						finishReason: { raw: undefined, unified: 'tool-calls' as const },
						usage: mockUsage(10, 5),
						warnings: []
					})
				}),
				prompt: 'hello',
				telemetry: { functionId: 'eval.telemetry', recordInputs: false, recordOutputs: false },
				tools: {
					lot: tool({
						description: 'looks up a lot',
						execute: async () => {
							throw new Error(
								'no lot found: user holds 900 NVDA @ 128.40 and 40 TSLA in account IB-U1234567'
							);
						},
						inputSchema: z.strictObject({})
					})
				}
			}).catch(() => undefined);
		});

		expect(tools.length).toBe(1);
		const row = tools[0];
		if (row === undefined) throw new Error('unreachable');
		expect(row.ok).toBe(false);
		const serialised = dump(row);
		expect(serialised).not.toContain('NVDA');
		expect(serialised).not.toContain('128.40');
		expect(serialised).not.toContain('IB-U1234567');
		expect(serialised).not.toContain('900');
	});

	test('with NO ALS context, nothing is written — a row can never be misattributed', async () => {
		await generateText({
			instructions: 'you are a test',
			maxRetries: 0,
			model: new MockLanguageModelV4({
				doGenerate: async () => ({
					content: [{ text: 'ok', type: 'text' as const }],
					finishReason: { raw: undefined, unified: 'stop' as const },
					usage: mockUsage(1, 1),
					warnings: []
				})
			}),
			prompt: 'hello',
			telemetry: { functionId: 'eval.telemetry', recordInputs: false, recordOutputs: false }
		});

		expect(calls.length).toBe(0);
	});

	test('a sink that throws does not fail the caller — telemetry is never load-bearing', async () => {
		const exploding = createLedgerTelemetry({
			writeCall: async () => {
				throw new Error('database is down');
			},
			writeToolCall: async () => undefined
		});
		// Invoke the hook directly: registering a second integration globally would pollute the file.
		await runWithAiContext(ctx(), async () => {
			await expect(exploding.onError?.({ error: new Error('x') } as never)).resolves.toBeUndefined();
		});
	});
});

describe('registerAiTelemetryOnce — registerTelemetry pushes onto a global array', () => {
	test('the second registration is refused, so rows are never double-written', () => {
		const noop = createLedgerTelemetry({ writeCall: async () => undefined, writeToolCall: async () => undefined });
		const first = registerAiTelemetryOnce(noop);
		const second = registerAiTelemetryOnce(noop);
		const third = registerAiTelemetryOnce(noop);
		expect(first).toBe(true);
		expect(second).toBe(false);
		expect(third).toBe(false);
	});
});

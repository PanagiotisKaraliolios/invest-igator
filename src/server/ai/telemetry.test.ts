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

	test('a raw key that slipped into the message text is scrubbed anyway', () => {
		expect(scrubSecrets('rejected: sk-abcdef0123456789 is invalid')).not.toContain('sk-abcdef0123456789');
		expect(scrubSecrets('api-key: a1b2c3d4e5f6a7b8')).not.toContain('a1b2c3d4e5f6a7b8');
	});

	test('messages are hard-capped', () => {
		expect(scrubSecrets('x'.repeat(5000)).length).toBeLessThanOrEqual(500);
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

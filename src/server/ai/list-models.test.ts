import { afterEach, describe, expect, test } from 'bun:test';
import { listProviderModels } from './list-models';

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

/**
 * Records the requests the module makes, and replies with a fixed JSON body.
 *
 * Uses a REAL `Response` so the body is a genuine readable stream: the module reads bodies
 * through a streaming size cap, and a hand-rolled stub with only `json()` would silently bypass
 * the very code path the size-bound tests below exercise.
 */
function mockFetch(body: unknown, init?: { ok?: boolean; status?: number; contentLength?: string }) {
	const calls: Array<{ url: string; headers: Record<string, string> }> = [];
	globalThis.fetch = (async (input: RequestInfo | URL, options?: RequestInit) => {
		calls.push({ headers: (options?.headers ?? {}) as Record<string, string>, url: String(input) });
		const headers = new Headers({ 'content-type': 'application/json' });
		if (init?.contentLength !== undefined) headers.set('content-length', init.contentLength);
		return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
			headers,
			status: init?.status ?? (init?.ok === false ? 500 : 200)
		});
	}) as typeof fetch;
	return calls;
}

describe('listProviderModels', () => {
	test('OPENAI parses data[].id, sorts, and de-duplicates', async () => {
		const calls = mockFetch({ data: [{ id: 'gpt-5' }, { id: 'gpt-4' }, { id: 'gpt-5' }] });
		const result = await listProviderModels({ provider: 'OPENAI', secret: 'sk-test-key' });

		expect(result).toEqual({ models: ['gpt-4', 'gpt-5'], supported: true });
		expect(calls[0]?.url).toBe('https://api.openai.com/v1/models');
		expect(calls[0]?.headers.Authorization).toBe('Bearer sk-test-key');
	});

	test('OPENAI_COMPATIBLE uses the supplied baseURL, normalised', async () => {
		const calls = mockFetch({ data: [{ id: 'llama-3' }] });
		const result = await listProviderModels({
			baseURL: 'https://ollama.example.com/v1/',
			provider: 'OPENAI_COMPATIBLE',
			secret: 'sk-test-key'
		});

		expect(result).toEqual({ models: ['llama-3'], supported: true });
		// normalizeBaseUrl strips the trailing slash AND the trailing /v1 before we re-append it.
		expect(calls[0]?.url).toBe('https://ollama.example.com/v1/models');
	});

	test('ANTHROPIC sends x-api-key and the pinned anthropic-version', async () => {
		const calls = mockFetch({ data: [{ id: 'claude-opus-5' }] });
		const result = await listProviderModels({ provider: 'ANTHROPIC', secret: 'sk-ant-key' });

		expect(result).toEqual({ models: ['claude-opus-5'], supported: true });
		expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/models');
		expect(calls[0]?.headers['x-api-key']).toBe('sk-ant-key');
		expect(calls[0]?.headers['anthropic-version']).toBe('2023-06-01');
	});

	test('GOOGLE strips the models/ prefix', async () => {
		mockFetch({ models: [{ name: 'models/gemini-3-pro' }, { name: 'models/gemini-3-flash' }] });
		const result = await listProviderModels({ provider: 'GOOGLE', secret: 'goog-key' });

		expect(result).toEqual({ models: ['gemini-3-flash', 'gemini-3-pro'], supported: true });
	});

	test('AZURE is unsupported and makes no request', async () => {
		const calls = mockFetch({ data: [] });
		const result = await listProviderModels({ provider: 'AZURE', secret: 'azure-key' });

		expect(result).toEqual({ supported: false });
		expect(calls).toHaveLength(0);
	});

	test('a non-2xx response throws, and the message never contains the secret', async () => {
		mockFetch({}, { ok: false, status: 401 });
		const promise = listProviderModels({ provider: 'OPENAI', secret: 'sk-super-secret' });

		await expect(promise).rejects.toThrow(/401/);
		await promise.catch((err: unknown) => {
			expect(String(err)).not.toContain('sk-super-secret');
		});
	});

	test('OPENAI_COMPATIBLE without a baseURL throws rather than hitting OpenAI', async () => {
		const calls = mockFetch({ data: [] });
		await expect(listProviderModels({ provider: 'OPENAI_COMPATIBLE', secret: 'sk-x' })).rejects.toThrow();
		expect(calls).toHaveLength(0);
	});

	test('ignores malformed entries instead of emitting empty ids', async () => {
		mockFetch({ data: [{ id: 'gpt-5' }, { id: '' }, { notAnId: true }, null] });
		const result = await listProviderModels({ provider: 'OPENAI', secret: 'sk-test-key' });

		expect(result).toEqual({ models: ['gpt-5'], supported: true });
	});

	test('a raw fetch rejection cannot leak the secret (Google puts the key in the URL)', async () => {
		globalThis.fetch = (async () => {
			throw new Error(
				'connect ECONNREFUSED https://generativelanguage.googleapis.com/v1beta/models?key=goog-super-secret'
			);
		}) as typeof fetch;

		const promise = listProviderModels({ provider: 'GOOGLE', secret: 'goog-super-secret' });

		await expect(promise).rejects.toThrow();
		await promise.catch((error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			expect(message).not.toContain('goog-super-secret');
			expect(message).toContain('[redacted]');
		});
	});
});

describe('listProviderModels response size bound', () => {
	test('rejects on a declared content-length over the cap, before reading the body', async () => {
		// The body itself is small and perfectly valid, so the ONLY way this can fail is the
		// content-length pre-check firing first — which is exactly what we want to pin.
		mockFetch({ data: [{ id: 'gpt-5' }] }, { contentLength: '999999999' });

		await expect(listProviderModels({ provider: 'OPENAI', secret: 'sk-test-key' })).rejects.toThrow(
			/too large \(999999999 bytes\)/
		);
	});

	test('rejects an oversized body that declares no content-length, and stops reading it', async () => {
		// A 1 MB chunk repeated forever: a naive `response.text()` would buffer until it OOMs.
		const chunk = new TextEncoder().encode('x'.repeat(1_000_000));
		let chunksServed = 0;
		let cancelled = false;
		globalThis.fetch = (async () => {
			const stream = new ReadableStream<Uint8Array>({
				cancel() {
					cancelled = true;
				},
				pull(controller) {
					chunksServed += 1;
					controller.enqueue(chunk);
				}
			});
			// Deliberately NO content-length, so only the streaming cap can save us.
			return new Response(stream, { status: 200 });
		}) as typeof fetch;

		await expect(listProviderModels({ provider: 'OPENAI', secret: 'sk-test-key' })).rejects.toThrow(/too large/);
		// Bound is 2 MB, so it must give up after a handful of 1 MB chunks — not stream forever.
		expect(chunksServed).toBeLessThan(5);
		expect(cancelled).toBe(true);
	});

	test('a normal-sized body is still parsed correctly', async () => {
		mockFetch({ data: [{ id: 'gpt-5' }] }, { contentLength: '32' });
		const result = await listProviderModels({ provider: 'OPENAI', secret: 'sk-test-key' });
		expect(result).toEqual({ models: ['gpt-5'], supported: true });
	});

	test('a malformed JSON body fails without leaking the secret', async () => {
		mockFetch('not json at all');
		const promise = listProviderModels({ provider: 'OPENAI', secret: 'sk-super-secret' });

		await expect(promise).rejects.toThrow();
		await promise.catch((error: unknown) => {
			expect(String(error)).not.toContain('sk-super-secret');
		});
	});
});

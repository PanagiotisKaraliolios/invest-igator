import { normalizeBaseUrl } from '@/server/ai/credential-config';
import type { ByokProvider } from '@/server/ai/probe';
import { safeProviderErrorMessage } from '@/server/ai/provider-errors';

export type ListModelsParams = {
	baseURL?: string | null;
	provider: ByokProvider;
	secret: string;
};

export type ListModelsResult = { models: string[]; supported: true } | { supported: false };

/** Anthropic requires a pinned API version header; this is the stable public value. */
const ANTHROPIC_VERSION = '2023-06-01';
const TIMEOUT_MS = 10_000;
/** A misbehaving endpoint must not be able to push an unbounded list into the browser. */
const MAX_MODELS = 500;

const DEFAULT_BASE_URLS = {
	ANTHROPIC: 'https://api.anthropic.com',
	GOOGLE: 'https://generativelanguage.googleapis.com',
	OPENAI: 'https://api.openai.com'
} as const;

/**
 * `normalizeBaseUrl` strips a trailing `/v1` (the Azure `/v1/v1` trap), so every caller
 * re-appends the full path it needs. That keeps one normalisation rule for what a user pastes.
 */
function resolveBase(raw: string | null | undefined, fallback: string): string {
	const trimmed = raw?.trim();
	return trimmed ? normalizeBaseUrl(trimmed) : fallback;
}

/**
 * Resolve a RELATIVE `path` (no leading slash) against `base` via the WHATWG `URL`
 * resolver instead of string concatenation. String concatenation lets a `?` or `#`
 * embedded in `base` (e.g. a pasted `file:///etc/hostname?`) rewrite the appended path
 * into the query/fragment instead of the pathname — `URL` resolution cannot be fooled
 * that way. Unlike resolving a LEADING-slash path (which resets to the root), a
 * relative path also preserves an existing base path segment, e.g.
 * `https://gateway.example.com/openai` + `v1/models` -> `.../openai/v1/models`.
 */
function urlFor(base: string, path: string): URL {
	return new URL(path, base.endsWith('/') ? base : `${base}/`);
}

/**
 * The `baseURL` is user-supplied, so the endpoint on the other end is untrusted: it can return a
 * body of any size. A real model list is a few KB, so 2 MB is generous while still bounding the
 * blast radius of a hostile or broken endpoint.
 */
const MAX_RESPONSE_BYTES = 2_000_000;

/**
 * Read a response body without letting an untrusted endpoint decide how much memory we spend.
 *
 * `response.text()` alone is NOT sufficient: it buffers the whole body first, so a multi-gigabyte
 * response would exhaust memory before any size check could run. Streaming lets us stop reading
 * (and cancel the transfer) the moment the cap is passed. `content-length`, when the server
 * bothers to send it, short-circuits before we read a single byte.
 *
 * Falls back to `text()` when the response exposes no readable stream (a stubbed Response in a
 * test, or any runtime that omits `body`), so the caller's contract does not change.
 */
async function readBounded(response: Response): Promise<string> {
	const declared = Number(response.headers?.get?.('content-length') ?? Number.NaN);
	if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
		throw new Error(`The provider's response is too large (${declared} bytes).`);
	}

	const reader = response.body?.getReader?.();
	if (!reader) return await response.text();

	const decoder = new TextDecoder();
	let text = '';
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_RESPONSE_BYTES) {
			await reader.cancel();
			throw new Error("The provider's response is too large.");
		}
		text += decoder.decode(value, { stream: true });
	}
	return text + decoder.decode();
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const response = await fetch(url, { headers, signal: controller.signal });
		if (!response.ok) {
			throw new Error(`The provider returned ${response.status} ${response.statusText}`);
		}
		return JSON.parse(await readBounded(response)) as unknown;
	} finally {
		clearTimeout(timer);
	}
}

/** Sort, de-duplicate, drop blanks, and bound the list. */
function tidy(ids: Array<string | undefined>): string[] {
	const clean = ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
	return Array.from(new Set(clean.map((id) => id.trim())))
		.sort()
		.slice(0, MAX_MODELS);
}

/** `{ data: [{ id }] }` — OpenAI's /v1/models shape, which Anthropic also uses. */
function idsFromDataArray(payload: unknown): string[] {
	const data = (payload as { data?: unknown })?.data;
	if (!Array.isArray(data)) return [];
	return tidy(data.map((entry) => (entry as { id?: string } | null)?.id));
}

/** `{ models: [{ name: 'models/gemini-x' }] }` — Google's ListModels shape. */
function idsFromGoogleModels(payload: unknown): string[] {
	const models = (payload as { models?: unknown })?.models;
	if (!Array.isArray(models)) return [];
	return tidy(models.map((entry) => (entry as { name?: string } | null)?.name?.replace(/^models\//, '')));
}

/**
 * List the models a BYOK credential can serve.
 *
 * Called with the values a user has typed into the add-key dialog — the credential row does
 * not exist yet — so it takes a plaintext secret rather than a userId. It performs no writes.
 *
 * AZURE is deliberately unsupported: Azure exposes *deployments*, not models, via a different
 * data-plane call, and a deployment name is not the model name we price on.
 */
export async function listProviderModels(params: ListModelsParams): Promise<ListModelsResult> {
	const { baseURL, provider, secret } = params;

	try {
		// A `switch` over the same union `buildByokModel` (resolve-model.ts) dispatches on,
		// with the same `never`-assignment exhaustiveness check, so adding a provider without
		// updating both call sites is a compile error rather than a silent 404.
		switch (provider) {
			case 'AZURE':
				return { supported: false };

			case 'GOOGLE': {
				const base = resolveBase(baseURL, DEFAULT_BASE_URLS.GOOGLE);
				const url = urlFor(base, 'v1beta/models');
				url.searchParams.set('key', secret);
				const payload = await getJson(url.toString(), {});
				return { models: idsFromGoogleModels(payload), supported: true };
			}

			case 'ANTHROPIC': {
				const base = resolveBase(baseURL, DEFAULT_BASE_URLS.ANTHROPIC);
				const url = urlFor(base, 'v1/models');
				const payload = await getJson(url.toString(), {
					'anthropic-version': ANTHROPIC_VERSION,
					'x-api-key': secret
				});
				return { models: idsFromDataArray(payload), supported: true };
			}

			case 'OPENAI':
			case 'OPENAI_COMPATIBLE': {
				if (provider === 'OPENAI_COMPATIBLE' && !baseURL?.trim()) {
					throw new Error('A base URL is required to list models for an OpenAI-compatible provider.');
				}
				const base = resolveBase(baseURL, DEFAULT_BASE_URLS.OPENAI);
				const url = urlFor(base, 'v1/models');
				const payload = await getJson(url.toString(), { Authorization: `Bearer ${secret}` });
				return { models: idsFromDataArray(payload), supported: true };
			}

			default: {
				const exhaustive: never = provider;
				throw new Error(`Unsupported provider: ${exhaustive}`);
			}
		}
	} catch (error) {
		// GOOGLE puts the plaintext key in the URL query string; any error that embeds the
		// request (a raw fetch rejection, an SDK error, a future provider) must not escape
		// this function un-redacted. Route every throw through the shared redactor rather
		// than relying on callers to remember to do it.
		throw new Error(safeProviderErrorMessage(error, secret));
	}
}

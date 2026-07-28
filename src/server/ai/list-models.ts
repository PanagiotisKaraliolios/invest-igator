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

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const response = await fetch(url, { headers, signal: controller.signal });
		if (!response.ok) {
			throw new Error(`The provider returned ${response.status} ${response.statusText}`);
		}
		return await response.json();
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

	if (provider === 'AZURE') return { supported: false };

	try {
		if (provider === 'GOOGLE') {
			const base = resolveBase(baseURL, DEFAULT_BASE_URLS.GOOGLE);
			const payload = await getJson(`${base}/v1beta/models?key=${encodeURIComponent(secret)}`, {});
			return { models: idsFromGoogleModels(payload), supported: true };
		}

		if (provider === 'ANTHROPIC') {
			const base = resolveBase(baseURL, DEFAULT_BASE_URLS.ANTHROPIC);
			const payload = await getJson(`${base}/v1/models`, {
				'anthropic-version': ANTHROPIC_VERSION,
				'x-api-key': secret
			});
			return { models: idsFromDataArray(payload), supported: true };
		}

		if (provider === 'OPENAI_COMPATIBLE' && !baseURL?.trim()) {
			throw new Error('A base URL is required to list models for an OpenAI-compatible provider.');
		}

		const base = resolveBase(baseURL, DEFAULT_BASE_URLS.OPENAI);
		const payload = await getJson(`${base}/v1/models`, { Authorization: `Bearer ${secret}` });
		return { models: idsFromDataArray(payload), supported: true };
	} catch (error) {
		// GOOGLE puts the plaintext key in the URL query string; any error that embeds the
		// request (a raw fetch rejection, an SDK error, a future provider) must not escape
		// this function un-redacted. Route every throw through the shared redactor rather
		// than relying on callers to remember to do it.
		throw new Error(safeProviderErrorMessage(error, secret));
	}
}

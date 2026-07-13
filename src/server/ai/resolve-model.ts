import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

import { open } from '@/server/ai/crypto';
import { applyGuardrails, markUnguarded, type Unguarded } from '@/server/ai/guardrails';
import { platformModel, type ResolvedModel } from '@/server/ai/registry';
import { db } from '@/server/db';

export class InvalidCredentialError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidCredentialError';
	}
}

type ByokProvider = 'AZURE' | 'OPENAI' | 'ANTHROPIC' | 'GOOGLE' | 'OPENAI_COMPATIBLE';

const PROVIDERS: ReadonlySet<string> = new Set<ByokProvider>([
	'ANTHROPIC',
	'AZURE',
	'GOOGLE',
	'OPENAI',
	'OPENAI_COMPATIBLE'
]);

/** The plaintext config half of an AiProviderCredential row. Only the secret is encrypted. */
export type ByokConfig = {
	apiVersion: string | null;
	baseURL: string | null;
	defaultModelId: string;
	deployment: string | null;
	provider: ByokProvider;
	resourceName: string | null;
};

/** Blank-to-null: `emptyStringAsUndefined` does not apply to DB columns. */
function orNull(value: string | null): string | null {
	if (value === null) return null;
	const trimmed = value.trim();
	return trimmed === '' ? null : trimmed;
}

/**
 * Narrow the Prisma row to ByokConfig. Do NOT pass the row straight through: its `provider`
 * is a Prisma enum (a widened string at the call site of a generic helper) and a blank
 * `defaultModelId` would produce a model id of '' — a 404 that looks like a bad key.
 */
function toByokConfig(row: {
	apiVersion: string | null;
	baseURL: string | null;
	defaultModelId: string;
	deployment: string | null;
	provider: string;
	resourceName: string | null;
}): ByokConfig {
	if (!PROVIDERS.has(row.provider)) {
		throw new InvalidCredentialError(`unsupported provider: ${row.provider}`);
	}
	const defaultModelId = orNull(row.defaultModelId);
	if (defaultModelId === null) {
		throw new InvalidCredentialError('credential is missing defaultModelId');
	}
	return {
		apiVersion: orNull(row.apiVersion),
		baseURL: orNull(row.baseURL),
		defaultModelId,
		deployment: orNull(row.deployment),
		provider: row.provider as ByokProvider,
		resourceName: orNull(row.resourceName)
	};
}

/**
 * The Azure SDK builds `baseURL ?? https://{resourceName}.openai.azure.com/openai`
 * and appends `/v1{path}` ITSELF. A user who pastes an endpoint ending in `/v1` gets
 * `/v1/v1/responses` -> 404, which looks exactly like a broken key. Normalise at save
 * time AND here.
 *
 * The Azure Portal's "Target URI" field hands users a FULL deployment URL —
 * `.../openai/deployments/<name>/chat/completions?api-version=...` — not a bare endpoint.
 * Anything after the `/openai` path segment is deployment/operation routing the SDK derives
 * itself, so truncate the path there. AI Foundry's `/models` form (and a bare host) has no
 * `/openai` segment at all — append one rather than passing the URL through untouched, which
 * is the same 404-that-looks-like-a-broken-key failure this function exists to prevent.
 */
export function normaliseAzureBaseUrl(raw: string): string {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		throw new InvalidCredentialError(`Azure baseURL is not a valid URL: ${raw}`);
	}
	url.search = '';
	url.hash = '';

	let path = url.pathname.replace(/\/+$/, '');
	while (path.endsWith('/v1')) {
		path = path.slice(0, -'/v1'.length).replace(/\/+$/, '');
	}

	const segments = path.split('/').filter((segment) => segment.length > 0);
	const openaiIndex = segments.findIndex((segment) => segment.toLowerCase() === 'openai');
	path = openaiIndex === -1 ? `${path}/openai` : `/${segments.slice(0, openaiIndex + 1).join('/')}`;

	url.pathname = path;

	return url.toString().replace(/\/+$/, '');
}

/** createAzure takes resourceName XOR baseURL — passing both is a construction-time throw. */
function azureEndpoint(cfg: ByokConfig): { baseURL: string } | { resourceName: string } {
	const baseURL = orNull(cfg.baseURL);
	const resourceName = orNull(cfg.resourceName);

	if (baseURL !== null && resourceName === null) return { baseURL: normaliseAzureBaseUrl(baseURL) };
	if (resourceName !== null && baseURL === null) return { resourceName };

	throw new InvalidCredentialError('Azure credential requires exactly one of resourceName or baseURL');
}

function requireBaseUrl(cfg: ByokConfig): string {
	const baseURL = orNull(cfg.baseURL);
	if (baseURL === null) {
		throw new InvalidCredentialError(`${cfg.provider} credential requires a baseURL`);
	}
	return baseURL;
}

function requireModelId(cfg: ByokConfig): string {
	const modelId = orNull(cfg.defaultModelId);
	if (modelId === null) {
		throw new InvalidCredentialError(`${cfg.provider} credential requires a defaultModelId`);
	}
	return modelId;
}

/**
 * Builds the raw provider model. Per-request construction is effectively free: there is no
 * vendor SDK object and no socket pool — all HTTP goes through the global undici pool. NEVER
 * pass a custom `fetch` that builds a new Agent per instance.
 *
 * Returns an `Unguarded` wrapper, NOT a `LanguageModel` — passing the result straight to
 * `generateText`/`streamText` as `model:` is a TYPE ERROR, not just against doc-comment advice.
 * `applyGuardrails()` is the only function that can turn it into something they accept.
 */
export function buildByokModel(cfg: ByokConfig, apiKey: string): Unguarded {
	const modelId = requireModelId(cfg);
	const optionalBaseUrl = orNull(cfg.baseURL);

	switch (cfg.provider) {
		case 'AZURE': {
			const apiVersion = orNull(cfg.apiVersion);
			const azure = createAzure({
				apiKey,
				...azureEndpoint(cfg),
				// null => the SDK default, the literal string 'v1'. Never a date.
				...(apiVersion !== null ? { apiVersion } : {})
			});
			// For Azure the DEPLOYMENT NAME is the model id.
			return markUnguarded(azure(orNull(cfg.deployment) ?? modelId));
		}
		case 'OPENAI': {
			const openai = createOpenAI({
				apiKey,
				...(optionalBaseUrl !== null ? { baseURL: optionalBaseUrl } : {})
			});
			return markUnguarded(openai(modelId));
		}
		case 'ANTHROPIC': {
			const anthropic = createAnthropic({
				apiKey,
				...(optionalBaseUrl !== null ? { baseURL: optionalBaseUrl } : {})
			});
			return markUnguarded(anthropic(modelId));
		}
		case 'GOOGLE': {
			const google = createGoogleGenerativeAI({
				apiKey,
				...(optionalBaseUrl !== null ? { baseURL: optionalBaseUrl } : {})
			});
			return markUnguarded(google(modelId));
		}
		case 'OPENAI_COMPATIBLE': {
			const compatible = createOpenAICompatible({
				apiKey,
				baseURL: requireBaseUrl(cfg),
				name: 'byok'
			});
			return markUnguarded(compatible(modelId));
		}
	}
}

/**
 * BYOK if the user has an enabled credential, otherwise the platform model.
 *
 * BYOK bypasses platform QUOTA — and nothing else. Same guardrails, same tool authorization.
 * The quota check lives in a separate code path (Task 8) precisely so that a BYOK
 * short-circuit cannot accidentally skip both.
 *
 * A BROKEN BYOK credential THROWS. It must never fall through to platformModel(): that would
 * silently move a BYOK user's spend onto the platform's card — and hide the misconfiguration.
 */
export async function resolveModel(userId: string): Promise<ResolvedModel> {
	const cred = await db.aiProviderCredential.findFirst({
		// Scoped to THIS user. Deterministic pick if Task 4's uniqueness ever regresses.
		orderBy: { updatedAt: 'desc' },
		where: { enabled: true, userId }
	});
	if (cred === null) return platformModel();

	const cfg = toByokConfig(cred);

	// The AAD binds the ciphertext to (CALLER userId, provider): a row copied to another
	// tenant FAILS to decrypt rather than silently working. Pass the caller's id — never
	// cred.userId, which would make a stolen row decrypt for whoever holds it.
	const secret = open(
		{
			authTag: cred.authTag,
			ciphertext: cred.ciphertext,
			iv: cred.iv,
			kid: cred.kid
		},
		userId,
		cfg.provider
	);

	const model = buildByokModel(cfg, secret.expose());

	return {
		byok: true,
		// The SAME guardrail stack the platform registry uses. BYOK cannot skip it.
		model: applyGuardrails(model),
		modelId: cfg.provider === 'AZURE' ? (cfg.deployment ?? cfg.defaultModelId) : cfg.defaultModelId,
		providerId: cfg.provider.toLowerCase(),
		// The REAL model. NEVER price on modelId — for Azure that is the deployment name.
		resolvedModel: cfg.defaultModelId
	};
}

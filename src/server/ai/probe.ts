import { generateText, type LanguageModel } from 'ai';
import type { Secret } from '@/server/ai/crypto';
import { applyGuardrails } from '@/server/ai/guardrails';
import { type ByokConfig, buildByokModel as buildRawByokModel } from '@/server/ai/resolve-model';

export type { ByokConfig } from '@/server/ai/resolve-model';
/** Derived from `ByokConfig['provider']` — there is exactly one BYOK provider union, not two. */
export type ByokProvider = ByokConfig['provider'];

export type ProbeResult = { ok: true } | { error: string; ok: false };

/**
 * Build a LanguageModel from a plaintext BYOK secret.
 *
 * Deliberately NOT `resolveModel(userId)`: at save time the credential row does not
 * exist yet, and an unverified credential must never be persisted.
 *
 * Deliberately NOT a second provider-construction switch either: `buildRawByokModel`
 * (Task 6, `resolve-model.ts`) is the SAME function `resolveModel()` calls on every
 * real request — including its Azure `resourceName` XOR `baseURL` guard and its reuse
 * of `normaliseAzureBaseUrl` for the `/v1/v1` and Target-URI traps. Re-deriving that
 * switch here would be a second implementation of the Azure endpoint logic that could
 * silently drift from the one `resolveModel()` actually uses — exactly the risk this
 * probe exists to catch. `applyGuardrails` then attaches the SAME frozen guardrail
 * stack the platform registry uses, so BYOK cannot skip it via this path either.
 */
export function buildByokModel(config: ByokConfig, secret: Secret): LanguageModel {
	return applyGuardrails(buildRawByokModel(config, secret.expose()));
}

/**
 * R8: provider SDK errors embed the request config, INCLUDING the auth header.
 * `JSON.stringify(err)` into a tRPC error body leaks the user's key straight back to
 * the browser (and into any log that captures it). Pick fields explicitly, truncate,
 * and redact the plaintext defensively.
 */
function safeErrorMessage(error: unknown, secret: Secret): string {
	const raw = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown provider error';
	return raw.replaceAll(secret.expose(), '[redacted]').slice(0, 300);
}

/**
 * A live, minimal probe. Azure's multi-field config makes silent misconfiguration the
 * DEFAULT failure mode; catching it here rather than mid-conversation is worth one request.
 *
 * 16 output tokens, not 1: GPT-5.x are reasoning models and can spend the whole budget on
 * reasoning tokens, so a 1-token ceiling can fail a valid key.
 *
 * Also catches `buildByokModel`'s synchronous config-validation throws (e.g. Azure given
 * both `resourceName` and `baseURL`) — those are just as much "this credential does not
 * work" as a network-level rejection, and surface through the identical `{ ok: false }` path.
 */
export async function probeCredential(config: ByokConfig, secret: Secret): Promise<ProbeResult> {
	try {
		await generateText({
			maxOutputTokens: 16,
			model: buildByokModel(config, secret),
			prompt: 'ping',
			telemetry: { functionId: 'byok.probe', recordInputs: false, recordOutputs: false }
		});
		return { ok: true };
	} catch (error) {
		return { error: safeErrorMessage(error, secret), ok: false };
	}
}

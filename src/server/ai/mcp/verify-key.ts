import { createHmac, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '@/env';
import { db } from '@/server/db';
import type { Scope } from '@/server/ai/tools/types';

/** The five tool resources that map to a `Scope`. `account`/`admin`/`ai`/`apiKeys` are not tools. */
const TOOL_RESOURCES = ['portfolio', 'transactions', 'watchlist', 'goals', 'fx'] as const;

/**
 * Maps an API key's Better-Auth permissions JSON (`{ resource: [actions] }`) to the tool `Scope`
 * set. Read-only surface: only a `read` action on one of the five TOOL_RESOURCES becomes a
 * `${resource}:read` scope. Write actions and non-tool resources are ignored — Phase 2 is
 * read-only, and `buildToolset` drops mutating tools on the MCP surface regardless. Fails closed:
 * null / empty / malformed / non-object JSON yields an empty set.
 */
export function permissionsToScopes(permissionsJson: string | null): Set<Scope> {
	const scopes = new Set<Scope>();
	if (!permissionsJson) return scopes;

	let parsed: unknown;
	try {
		parsed = JSON.parse(permissionsJson);
	} catch {
		return scopes;
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return scopes;

	const perms = parsed as Record<string, unknown>;
	for (const resource of TOOL_RESOURCES) {
		const actions = perms[resource];
		if (Array.isArray(actions) && actions.includes('read')) {
			scopes.add(`${resource}:read`);
		}
	}
	return scopes;
}

/** HMAC-SHA256(token, pepper) hex, or null when the pepper is unconfigured (cannot verify). */
function computeKeyHmac(token: string): string | null {
	if (!env.AI_API_KEY_PEPPER) return null;
	return createHmac('sha256', env.AI_API_KEY_PEPPER).update(token).digest('hex');
}

/** Constant-time equality of two hex strings of equal byte length. */
function constantTimeEqualHex(a: string, b: string): boolean {
	const ab = Buffer.from(a, 'hex');
	const bb = Buffer.from(b, 'hex');
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

export type VerifiedKey = { userId: string; scopes: Set<Scope> };

/**
 * Resolves a bearer API key to its owner + tool scopes for the MCP surface, or null.
 *
 * Fast path: `keyHmac` is a UNIQUE indexed column, so `HMAC-SHA256(token, pepper)` is an O(1)
 * `findUnique`. The real "no timing oracle" protection is structural: an attacker only ever gets
 * a binary hit/miss from a unique-index lookup on an HMAC (avalanche) digest, never a
 * warmer/colder signal. The post-hit `constantTimeEqualHex` recheck below is cheap defensive
 * insurance (the fetched row's `keyHmac` equals the lookup key by construction), not the
 * load-bearing check.
 *
 * Legacy fallback: keys minted before `keyHmac` was populated have `keyHmac === null` and miss the
 * fast path. They are matched by their `start` bucket + `bcrypt.compareSync`, then `keyHmac` is
 * LAZILY BACKFILLED so every subsequent call is O(1) — every key self-heals on first MCP use with
 * no change to the key-creation flow.
 *
 * Fails closed: unconfigured pepper, empty/whitespace bearer, disabled, or expired ⇒ null.
 */
export async function verifyMcpKey(bearer: string): Promise<VerifiedKey | null> {
	const token = bearer.trim();
	if (token.length === 0) return null;

	const hmac = computeKeyHmac(token);
	if (hmac === null) return null;

	const byHmac = await db.apiKey.findUnique({ where: { keyHmac: hmac } });
	if (byHmac !== null) {
		if (!byHmac.enabled) return null;
		if (byHmac.expiresAt !== null && byHmac.expiresAt.getTime() <= Date.now()) return null;
		if (byHmac.keyHmac === null || !constantTimeEqualHex(byHmac.keyHmac, hmac)) return null;
		return { scopes: permissionsToScopes(byHmac.permissions), userId: byHmac.userId };
	}

	// Legacy fallback: match by start-bucket + bcrypt, then backfill keyHmac.
	const start = token.slice(0, 6);
	const candidates = await db.apiKey.findMany({ where: { keyHmac: null, start } });
	for (const cand of candidates) {
		if (!bcrypt.compareSync(token, cand.key)) continue;
		if (!cand.enabled) return null;
		if (cand.expiresAt !== null && cand.expiresAt.getTime() <= Date.now()) return null;
		await db.apiKey.update({ data: { keyHmac: hmac }, where: { id: cand.id } });
		return { scopes: permissionsToScopes(cand.permissions), userId: cand.userId };
	}
	return null;
}

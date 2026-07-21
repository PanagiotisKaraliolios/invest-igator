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

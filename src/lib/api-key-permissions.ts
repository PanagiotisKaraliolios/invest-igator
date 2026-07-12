/**
 * API Key Permissions System
 *
 * Defines available scopes and actions for API keys.
 * Each API key can have granular permissions controlling access to specific resources and actions.
 */

export const PERMISSION_SCOPES = {
	account: {
		actions: ['read', 'write', 'delete'] as const,
		description: 'Account management'
	},
	admin: {
		actions: ['read', 'write'] as const,
		description: 'Admin operations (requires admin role)'
	},
	ai: {
		// CAPABILITY, not a resource. Answers "may this key spend platform LLM quota?",
		// never "may this caller read this data?". It is deliberately absent from the
		// `Scope` union in src/server/ai/tools/types.ts and is never an AppTool.requiredScope —
		// a key can hold every read scope and still be barred from costing us money.
		actions: ['use'] as const,
		description: 'Use AI features (spends platform LLM quota)'
	},
	apiKeys: {
		actions: ['read', 'write', 'delete'] as const,
		description: 'API key management'
	},
	fx: {
		actions: ['read'] as const,
		description: 'Foreign exchange rates'
	},
	goals: {
		actions: ['read', 'write', 'delete'] as const,
		description: 'Financial goals'
	},
	portfolio: {
		actions: ['read', 'write'] as const,
		description: 'Portfolio data'
	},
	transactions: {
		actions: ['read', 'write', 'delete'] as const,
		description: 'Transaction records'
	},
	watchlist: {
		actions: ['read', 'write', 'delete'] as const,
		description: 'Watchlist management'
	}
} as const;

export type PermissionScope = keyof typeof PERMISSION_SCOPES;
export type PermissionAction<T extends PermissionScope> = (typeof PERMISSION_SCOPES)[T]['actions'][number];

/**
 * Predefined permission templates for common use cases
 */
export const PERMISSION_TEMPLATES = {
	custom: {
		description: 'Custom permissions',
		permissions: {}
	},
	'full-access': {
		description: 'Full access to all non-admin resources',
		permissions: {
			account: ['read', 'write', 'delete'],
			apiKeys: ['read', 'write', 'delete'],
			fx: ['read'],
			goals: ['read', 'write', 'delete'],
			portfolio: ['read', 'write'],
			transactions: ['read', 'write', 'delete'],
			watchlist: ['read', 'write', 'delete']
		}
	},
	'portfolio-manager': {
		description: 'Manage portfolio and transactions',
		permissions: {
			fx: ['read'],
			portfolio: ['read', 'write'],
			transactions: ['read', 'write', 'delete'],
			watchlist: ['read', 'write', 'delete']
		}
	},
	'read-only': {
		description: 'Read-only access to all resources',
		permissions: {
			account: ['read'],
			fx: ['read'],
			goals: ['read'],
			portfolio: ['read'],
			transactions: ['read'],
			watchlist: ['read']
		}
	}
} as const;

export type PermissionTemplate = keyof typeof PERMISSION_TEMPLATES;

/**
 * Converts permissions object to human-readable string
 */
export function formatPermissions(permissions: Record<string, string[]> | null): string {
	if (!permissions) return 'No permissions';

	const scopes = Object.keys(permissions);
	if (scopes.length === 0) return 'No permissions';
	if (scopes.length === 1) return `${scopes[0]}`;
	if (scopes.length === 2) return scopes.join(', ');
	return `${scopes.slice(0, 2).join(', ')} +${scopes.length - 2} more`;
}

/**
 * Gets a detailed description of permissions
 */
export function describePermissions(permissions: Record<string, string[]> | null): string[] {
	if (!permissions) return ['No permissions set'];

	return Object.entries(permissions).map(([scope, actions]) => {
		const scopeInfo = PERMISSION_SCOPES[scope as PermissionScope];
		const scopeLabel = scopeInfo?.description ?? scope;
		return `${scopeLabel}: ${actions.join(', ')}`;
	});
}

/**
 * Validates that permissions only include valid scopes and actions
 */
export function validatePermissionStructure(permissions: Record<string, string[]>): boolean {
	for (const [scope, actions] of Object.entries(permissions)) {
		// Check if scope is valid
		if (!(scope in PERMISSION_SCOPES)) return false;

		// Check if all actions are valid for this scope
		const validActions = PERMISSION_SCOPES[scope as PermissionScope].actions;
		if (!actions.every((action) => validActions.includes(action as never))) {
			return false;
		}
	}
	return true;
}

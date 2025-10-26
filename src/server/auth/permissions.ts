/**
 * Access Control configuration for Better Auth admin plugin
 *
 * This file defines the permission structure and roles for the application.
 * Better Auth's admin plugin requires explicit role definitions when using
 * custom roles like 'superadmin'.
 */

import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements } from 'better-auth/plugins/admin/access';

/**
 * Define the statement with all available permissions
 * Merge default admin permissions with any custom ones
 */
export const statement = {
	...defaultStatements
	// Add custom resources and permissions here if needed
	// example: { project: ["create", "update", "delete"] }
} as const;

/**
 * Create the access controller
 */
export const ac = createAccessControl(statement);

/**
 * Define the 'user' role with default user permissions (none for admin operations)
 */
export const user = ac.newRole({
	session: [], // Empty array means no permissions for session resource
	user: [] // Empty array means no permissions for user resource
});

/**
 * Define the 'admin' role with standard admin permissions
 */
export const admin = ac.newRole({
	...adminAc.statements // Include all default admin permissions
});

/**
 * Define the 'superadmin' role with full permissions (same as admin for now)
 * Superadmins have all admin permissions
 */
export const superadmin = ac.newRole({
	...adminAc.statements // Include all default admin permissions
});

import { adminClient, magicLinkClient, twoFactorClient } from 'better-auth/client/plugins';
import { nextCookies } from 'better-auth/next-js';
import { createAuthClient } from 'better-auth/react';
import { ac, admin as adminRole, superadmin as superadminRole, user as userRole } from '@/server/auth/permissions';

export const authClient = createAuthClient({
	// Better Auth client automatically uses window.location.origin in the browser
	// This ensures it uses the correct URL in both dev and production
	plugins: [
		adminClient({
			ac,
			roles: {
				admin: adminRole,
				superadmin: superadminRole,
				user: userRole
			}
		}),
		magicLinkClient(),
		twoFactorClient(),
		nextCookies()
	]
});

export const { signIn, signUp, signOut, useSession, requestPasswordReset, resetPassword, sendVerificationEmail } =
	authClient;

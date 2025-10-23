import { twoFactorClient } from 'better-auth/client/plugins';
import { nextCookies } from 'better-auth/next-js';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
	// Better Auth client automatically uses window.location.origin in the browser
	// This ensures it uses the correct URL in both dev and production
	plugins: [twoFactorClient(), nextCookies()]
});

export const { signIn, signUp, signOut, useSession, forgetPassword, resetPassword, sendVerificationEmail } = authClient;

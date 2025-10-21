import { twoFactorClient } from 'better-auth/client/plugins';
import { nextCookies } from 'better-auth/next-js';
import { createAuthClient } from 'better-auth/react';
import { env } from '@/env';

export const authClient = createAuthClient({
	baseURL: env.BETTER_AUTH_URL,
	plugins: [twoFactorClient(), nextCookies()]
});

export const { signIn, signUp, signOut, useSession, forgetPassword, resetPassword, sendVerificationEmail } = authClient;

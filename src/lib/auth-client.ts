import { twoFactorClient } from 'better-auth/client/plugins';
import { nextCookies } from 'better-auth/next-js';
import { createAuthClient } from 'better-auth/react';
import { env } from '@/env';

export const authClient = createAuthClient({
	baseURL: "https://invest-igator.vercel.app",
	plugins: [twoFactorClient(), nextCookies()]
});

export const { signIn, signUp, signOut, useSession, forgetPassword, resetPassword, sendVerificationEmail } = authClient;

import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
	/**
	 * Specify your client-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars. To expose them to the client, prefix them with
	 * `NEXT_PUBLIC_`.
	 */
	client: {
		// NEXT_PUBLIC_CLIENTVAR: z.string(),
	},
	/**
	 * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
	 * `SOME_VAR=''` will throw an error.
	 */
	emptyStringAsUndefined: true,

	/**
	 * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
	 * middlewares) or client-side so we need to destruct manually.
	 */
	runtimeEnv: {
		APP_NAME: process.env.APP_NAME,
		AUTH_DISCORD_ID: process.env.AUTH_DISCORD_ID,
		AUTH_DISCORD_SECRET: process.env.AUTH_DISCORD_SECRET,
		AUTH_SECRET: process.env.AUTH_SECRET,
		DATABASE_URL: process.env.DATABASE_URL,
		FINNHUB_API_KEY: process.env.FINNHUB_API_KEY,
		FINNHUB_API_URL: process.env.FINNHUB_API_URL,
		NODE_ENV: process.env.NODE_ENV,
		PASSWORD_PEPPER: process.env.PASSWORD_PEPPER
	},
	/**
	 * Specify your server-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars.
	 */
	server: {
		APP_NAME: z.string().default('Invest-igator'),
		AUTH_DISCORD_ID: z.string(),
		AUTH_DISCORD_SECRET: z.string(),
		AUTH_SECRET: process.env.NODE_ENV === 'production' ? z.string() : z.string().optional(),
		DATABASE_URL: z.url(),
		FINNHUB_API_KEY: z.string(),
		FINNHUB_API_URL: z.string().default('https://finnhub.io/api/v1'),
		NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
		PASSWORD_PEPPER: z.string()
	},
	/**
	 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
	 * useful for Docker builds.
	 */
	skipValidation: !!process.env.SKIP_ENV_VALIDATION
});

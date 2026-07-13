import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
	/**
	 * Specify your client-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars. To expose them to the client, prefix them with
	 * `NEXT_PUBLIC_`.
	 */
	client: {
		NEXT_PUBLIC_ADSENSE_CLIENT_ID: z.string().optional(),
		NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD: z.string().optional(),
		NEXT_PUBLIC_ADSENSE_SLOT_LANDING: z.string().optional(),
		NEXT_PUBLIC_ADSENSE_SLOT_WATCHLIST: z.string().optional(),
		NEXT_PUBLIC_GA_MEASUREMENT_ID: z.string().optional(),
		// NEXT_PUBLIC_CLIENTVAR: z.string(),
		NEXT_PUBLIC_SITE_URL: z.string().default('http://localhost:3000'),
		NEXT_PUBLIC_UMAMI_WEBSITE_ID: z.string().optional()
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
		AI_API_KEY_PEPPER: process.env.AI_API_KEY_PEPPER,
		AI_CRED_ACTIVE_KID: process.env.AI_CRED_ACTIVE_KID,
		AI_CRED_KEYS: process.env.AI_CRED_KEYS,
		APP_NAME: process.env.APP_NAME,
		AUTH_DISCORD_ID: process.env.AUTH_DISCORD_ID,
		AUTH_DISCORD_SECRET: process.env.AUTH_DISCORD_SECRET,
		AZURE_OPENAI_API_KEY: process.env.AZURE_OPENAI_API_KEY,
		AZURE_OPENAI_CHAT_DEPLOYMENT: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT,
		AZURE_OPENAI_CHAT_MODEL: process.env.AZURE_OPENAI_CHAT_MODEL,
		AZURE_OPENAI_RESOURCE_NAME: process.env.AZURE_OPENAI_RESOURCE_NAME,
		BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
		BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
		CLOUDFLARE_ACCESS_KEY_ID: process.env.CLOUDFLARE_ACCESS_KEY_ID,
		CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
		CLOUDFLARE_BUCKET_NAME: process.env.CLOUDFLARE_BUCKET_NAME,
		CLOUDFLARE_R2_PUBLIC_URL: process.env.CLOUDFLARE_R2_PUBLIC_URL,
		CLOUDFLARE_SECRET_ACCESS_KEY: process.env.CLOUDFLARE_SECRET_ACCESS_KEY,
		DATABASE_URL: process.env.DATABASE_URL,
		EMAIL_FROM: process.env.EMAIL_FROM,
		EMAIL_SERVER: process.env.EMAIL_SERVER,
		INFLUXDB_BUCKET: process.env.INFLUXDB_BUCKET,
		INFLUXDB_ORG: process.env.INFLUXDB_ORG,
		INFLUXDB_TOKEN: process.env.INFLUXDB_TOKEN,
		INFLUXDB_URL: process.env.INFLUXDB_URL,
		NEXT_PUBLIC_ADSENSE_CLIENT_ID: process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID,
		NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD: process.env.NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD,
		NEXT_PUBLIC_ADSENSE_SLOT_LANDING: process.env.NEXT_PUBLIC_ADSENSE_SLOT_LANDING,
		NEXT_PUBLIC_ADSENSE_SLOT_WATCHLIST: process.env.NEXT_PUBLIC_ADSENSE_SLOT_WATCHLIST,
		NEXT_PUBLIC_GA_MEASUREMENT_ID: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
		NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
		NEXT_PUBLIC_UMAMI_WEBSITE_ID: process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID,
		NODE_ENV: process.env.NODE_ENV,
		PASSWORD_PEPPER: process.env.PASSWORD_PEPPER,
		POLYGON_API_KEY: process.env.POLYGON_API_KEY,
		POLYGON_API_URL: process.env.POLYGON_API_URL,
		YAHOO_API_URL: process.env.YAHOO_API_URL
	},
	/**
	 * Specify your server-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars.
	 */
	server: {
		/**
		 * AI layer. The BYOK keyring vars (AI_CRED_*, AI_API_KEY_PEPPER) are OPTIONAL: BYOK
		 * degrades without them. The Azure OpenAI platform vars below are REQUIRED: the
		 * platform model is not optional, so a missing key fails at boot, not on the first
		 * user's first chat message.
		 */
		// HMAC pepper for O(1) ApiKey lookup (Phase 2). `openssl rand -base64 32`.
		AI_API_KEY_PEPPER: z.string().min(32).optional(),
		// Which key in AI_CRED_KEYS seals NEW rows. Retired kids stay in the ring, decrypt-only.
		AI_CRED_ACTIVE_KID: z.string().optional(),
		// BYOK keyring: {"k1":"<base64 32 bytes>"}. Parsed lazily in src/server/ai/crypto.ts —
		// a module-eval JSON.parse throw here would break `next build` when the var is absent.
		AI_CRED_KEYS: z.string().optional(),
		APP_NAME: z.string().default('Invest-igator'),
		AUTH_DISCORD_ID: z.string(),
		AUTH_DISCORD_SECRET: z.string(),
		// Platform provider (Azure OpenAI). REQUIRED — not optional: the platform model must
		// exist, so a missing key has to fail at boot, not on the first user's first chat message.
		AZURE_OPENAI_API_KEY: z.string(),
		// The DEPLOYMENT name. This is the string passed to azure() as the SDK "model id".
		AZURE_OPENAI_CHAT_DEPLOYMENT: z.string(),
		// The REAL model. This is what we PRICE on — never price on the deployment name.
		// Defaulted, not optional: a missing value here would silently yield UNKNOWN_MODEL rows.
		AZURE_OPENAI_CHAT_MODEL: z.string().default('gpt-5.4-mini'),
		// The resource NAME, not a URL. The SDK builds the endpoint and appends /v1{path} itself;
		// a value ending in /v1 yields /v1/v1/... -> 404.
		AZURE_OPENAI_RESOURCE_NAME: z.string(),
		BETTER_AUTH_SECRET: process.env.NODE_ENV === 'production' ? z.string() : z.string().optional(),
		BETTER_AUTH_URL: z.string().default('http://localhost:3000'),
		CLOUDFLARE_ACCESS_KEY_ID: z.string(),
		CLOUDFLARE_ACCOUNT_ID: z.string(),
		CLOUDFLARE_BUCKET_NAME: z.string(),
		CLOUDFLARE_R2_PUBLIC_URL: z.string().optional(),
		CLOUDFLARE_SECRET_ACCESS_KEY: z.string(),
		DATABASE_URL: z.url(),
		EMAIL_FROM: z.email(),
		EMAIL_SERVER: z.string(),
		INFLUXDB_BUCKET: z.string(),
		INFLUXDB_ORG: z.string(),
		INFLUXDB_TOKEN: z.string(),
		INFLUXDB_URL: z.string().default('http://localhost:8086'),
		NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
		PASSWORD_PEPPER: z.string(),
		POLYGON_API_KEY: z.string(),
		POLYGON_API_URL: z.string().default('https://api.polygon.io'),
		YAHOO_API_URL: z.string().default('https://query2.finance.yahoo.com/v8/finance')
	},
	/**
	 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
	 * useful for Docker builds.
	 */
	skipValidation: !!process.env.SKIP_ENV_VALIDATION
});

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
		ALPHAVANTAGE_API_KEY: process.env.ALPHAVANTAGE_API_KEY,
		ALPHAVANTAGE_API_URL: process.env.ALPHAVANTAGE_API_URL,
		APP_NAME: process.env.APP_NAME,
		AUTH_DISCORD_ID: process.env.AUTH_DISCORD_ID,
		AUTH_DISCORD_SECRET: process.env.AUTH_DISCORD_SECRET,
		AUTH_SECRET: process.env.AUTH_SECRET,
		DATABASE_URL: process.env.DATABASE_URL,
		EMAIL_FROM: process.env.EMAIL_FROM,
		EMAIL_SERVER: process.env.EMAIL_SERVER,
		FINNHUB_API_KEY: process.env.FINNHUB_API_KEY,
		FINNHUB_API_URL: process.env.FINNHUB_API_URL,
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
		YAHOO_CHART_API_URL: process.env.YAHOO_CHART_API_URL
	},
	/**
	 * Specify your server-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars.
	 */
	server: {
		ALPHAVANTAGE_API_KEY: z.string(),
		ALPHAVANTAGE_API_URL: z.string().default('https://www.alphavantage.co/query'),
		APP_NAME: z.string().default('Invest-igator'),
		AUTH_DISCORD_ID: z.string(),
		AUTH_DISCORD_SECRET: z.string(),
		AUTH_SECRET: process.env.NODE_ENV === 'production' ? z.string() : z.string().optional(),
		DATABASE_URL: z.url(),
		EMAIL_FROM: z.email(),
		EMAIL_SERVER: z.string(),
		FINNHUB_API_KEY: z.string(),
		FINNHUB_API_URL: z.string().default('https://finnhub.io/api/v1'),
		INFLUXDB_BUCKET: z.string(),
		INFLUXDB_ORG: z.string(),
		INFLUXDB_TOKEN: z.string(),
		INFLUXDB_URL: z.string().default('http://localhost:8086'),
		NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
		PASSWORD_PEPPER: z.string(),
		POLYGON_API_KEY: z.string(),
		POLYGON_API_URL: z.string().default('https://api.polygon.io'),
		YAHOO_CHART_API_URL: z.string().default('https://query2.finance.yahoo.com/v8/finance/chart')
	},
	/**
	 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
	 * useful for Docker builds.
	 */
	skipValidation: !!process.env.SKIP_ENV_VALIDATION
});

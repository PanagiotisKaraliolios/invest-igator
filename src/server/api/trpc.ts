/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */

import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';
import { hashApiKey, isApiKeyExpired } from '@/lib/api-keys';
import { auth } from '@/lib/auth';
import { db } from '@/server/db';

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
	try {
		// First, try to get a regular session
		let session = await auth.api.getSession({
			headers: opts.headers
		});

		// Track API key permissions separately from session
		let apiKeyPermissions: Record<string, string[]> | null = null;

		// If no session, check for API key in headers
		if (!session) {
			const apiKey = opts.headers.get('x-api-key');

			if (apiKey) {
				const hashedKey = hashApiKey(apiKey);

				// Look up the API key in the database
				const apiKeyRecord = await db.apiKey.findUnique({
					include: { user: true },
					where: { key: hashedKey }
				});

				// If valid, create a mock session and store permissions
				if (apiKeyRecord && apiKeyRecord.enabled && !isApiKeyExpired(apiKeyRecord.expiresAt)) {
					// Parse permissions from JSON string
					if (apiKeyRecord.permissions) {
						try {
							apiKeyPermissions = JSON.parse(apiKeyRecord.permissions) as Record<string, string[]>;
						} catch (error) {
							console.error('[TRPC Context] Failed to parse API key permissions:', error);
						}
					}

					session = {
						session: {
							createdAt: apiKeyRecord.createdAt,
							expiresAt: apiKeyRecord.expiresAt ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
							id: `apikey-${apiKeyRecord.id}`,
							impersonatedBy: null,
							ipAddress: null,
							token: `apikey-${apiKeyRecord.id}`,
							updatedAt: apiKeyRecord.updatedAt,
							userAgent: null,
							userId: apiKeyRecord.user.id
						},
						user: {
							banExpires: apiKeyRecord.user.banExpires,
							banned: apiKeyRecord.user.banned,
							banReason: apiKeyRecord.user.banReason,
							createdAt: apiKeyRecord.user.createdAt,
							email: apiKeyRecord.user.email ?? '',
							emailVerified: apiKeyRecord.user.emailVerified,
							id: apiKeyRecord.user.id,
							image: apiKeyRecord.user.image ?? null,
							name: apiKeyRecord.user.name ?? '',
							role: apiKeyRecord.user.role,
							twoFactorEnabled: apiKeyRecord.user.twoFactorEnabled,
							updatedAt: apiKeyRecord.user.updatedAt
						}
					};
				}
			}
		}

		return {
			apiKeyPermissions,
			db,
			session,
			...opts
		};
	} catch (error) {
		console.error('[TRPC Context] Failed to get session:', error);
		// Return context without session instead of crashing
		return {
			db,
			session: null,
			...opts
		};
	}
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
	errorFormatter({ shape, error }) {
		return {
			...shape,
			data: {
				...shape.data,
				zodError: error.cause instanceof ZodError ? error.cause.flatten() : null
			}
		};
	},
	transformer: superjson
});

/**
 * Create a server-side caller.
 *
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Middleware for timing procedure execution and adding an artificial delay in development.
 *
 * You can remove this if you don't like it, but it can help catch unwanted waterfalls by simulating
 * network latency that would occur in production but not in local development.
 */
const timingMiddleware = t.middleware(async ({ next, path }) => {
	const start = Date.now();

	if (t._config.isDev) {
		// artificial delay in dev
		const waitMs = Math.floor(Math.random() * 400) + 100;
		await new Promise((resolve) => setTimeout(resolve, waitMs));
	}

	const result = await next();

	const end = Date.now();
	console.log(`[TRPC] ${path} took ${end - start}ms to execute`);

	return result;
});

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 */
export const publicProcedure = t.procedure.use(timingMiddleware);

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedProcedure = t.procedure.use(timingMiddleware).use(({ ctx, next }) => {
	if (!ctx.session?.user) {
		throw new TRPCError({ code: 'UNAUTHORIZED' });
	}
	return next({
		ctx: {
			// infers the `session` as non-nullable
			apiKeyPermissions: ctx.apiKeyPermissions,
			session: { ...ctx.session, user: ctx.session.user }
		}
	});
});

/**
 * Helper function to create a protected procedure that requires specific permissions
 *
 * @param scope - The permission scope (e.g., 'watchlist', 'portfolio')
 * @param action - The required action (e.g., 'read', 'write', 'delete')
 */
export const withPermissions = (scope: string, action: string) => {
	return protectedProcedure.use(({ ctx, next }) => {
		// If authenticated via API key, check permissions
		if (ctx.apiKeyPermissions) {
			const scopeActions = ctx.apiKeyPermissions[scope];

			if (!scopeActions || !scopeActions.includes(action)) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: `API key does not have permission: ${scope}:${action}`
				});
			}
		}
		// Regular sessions have full access (no API key restrictions)

		return next({ ctx });
	});
};

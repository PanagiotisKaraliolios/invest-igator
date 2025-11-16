/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */

import { initTRPC, TRPCError } from '@trpc/server';
import bcrypt from 'bcryptjs';
import superjson from 'superjson';
import { ZodError } from 'zod';
import { isApiKeyExpired, isRefillDue } from '@/lib/api-keys';
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
				// Extract identifying info for lookup, e.g., start/prefix
				// Match the logic in generateApiKey: start = 6 + (prefix?.length ?? 0)
				// If prefix is used, assume it's separated by '_' (e.g., 'PREFIX_')
				const prefixMatch = apiKey.match(/^([A-Za-z0-9_]+_)/);
				const prefixLength = prefixMatch ? prefixMatch[1].length : 0;
				const START_LENGTH = 6 + prefixLength;
				const keyStart = apiKey.slice(0, START_LENGTH);

				const candidateApiKeys = await db.apiKey.findMany({
					include: { user: true },
					where: { start: keyStart }
				});

				// Try to find one whose hash matches (constant-time, no short-circuiting)
				let apiKeyRecord = null;
				for (const record of candidateApiKeys) {
					const match = await bcrypt.compare(apiKey, record.key);
					if (match && !apiKeyRecord) {
						apiKeyRecord = record;
					}
				}
				// Add a small random delay to normalize response time (50-150ms)
				await new Promise((resolve) => setTimeout(resolve, 50 + Math.floor(Math.random() * 100)));

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

					// Check rate limiting if enabled
					if (
						apiKeyRecord.rateLimitEnabled &&
						apiKeyRecord.rateLimitMax &&
						apiKeyRecord.rateLimitTimeWindow
					) {
						const now = new Date();
						const lastRequest = apiKeyRecord.lastRequest;
						const requestCount = apiKeyRecord.requestCount;

						// Check if we need to refill
						let shouldResetRateLimit = false;
						if (apiKeyRecord.refillAmount && apiKeyRecord.refillInterval && apiKeyRecord.lastRefillAt) {
							shouldResetRateLimit = isRefillDue(apiKeyRecord.lastRefillAt, apiKeyRecord.refillInterval);
						} else if (lastRequest) {
							// If no refill config, check if time window has passed
							const windowStart = new Date(lastRequest.getTime());
							const windowEnd = new Date(windowStart.getTime() + apiKeyRecord.rateLimitTimeWindow);
							shouldResetRateLimit = now >= windowEnd;
						}

						// If not resetting, check if limit is exceeded using requestCount
						// We check requestCount >= rateLimitMax because we're about to process THIS request
						if (!shouldResetRateLimit && requestCount >= apiKeyRecord.rateLimitMax) {
							// Calculate when the limit will reset
							const resetAt = lastRequest
								? new Date(lastRequest.getTime() + apiKeyRecord.rateLimitTimeWindow)
								: new Date(now.getTime() + apiKeyRecord.rateLimitTimeWindow);

							// Calculate remaining time in seconds
							const remainingMs = resetAt.getTime() - now.getTime();
							const remainingSeconds = Math.ceil(remainingMs / 1000);

							// Format the time message
							let timeMessage: string;
							if (remainingSeconds < 60) {
								timeMessage = `${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''}`;
							} else {
								const remainingMinutes = Math.ceil(remainingSeconds / 60);
								timeMessage = `${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
							}

							throw new TRPCError({
								code: 'TOO_MANY_REQUESTS',
								message: `Rate limit exceeded. Limit: ${apiKeyRecord.rateLimitMax} requests per ${apiKeyRecord.rateLimitTimeWindow / 1000}s. Try again in ${timeMessage}.`
							});
						}
					}

					// Update request count and last request timestamp
					// Fire and forget - don't block the request
					const updateData: {
						lastRequest: Date;
						requestCount: { increment: number } | number;
						lastRefillAt?: Date;
						remaining?: number;
					} = {
						lastRequest: new Date(),
						requestCount: { increment: 1 }
					};

					// Handle refill logic if configured
					if (
						apiKeyRecord.rateLimitEnabled &&
						apiKeyRecord.refillAmount &&
						apiKeyRecord.refillInterval &&
						apiKeyRecord.lastRefillAt &&
						isRefillDue(apiKeyRecord.lastRefillAt, apiKeyRecord.refillInterval)
					) {
						updateData.lastRefillAt = new Date();
						updateData.requestCount = 1; // Reset to 1 (this request)
						updateData.remaining = apiKeyRecord.rateLimitMax! - 1;
					} else if (
						apiKeyRecord.rateLimitEnabled &&
						apiKeyRecord.rateLimitMax &&
						apiKeyRecord.rateLimitTimeWindow &&
						apiKeyRecord.lastRequest
					) {
						// Check if time window has passed (without refill config)
						const now = new Date();
						const windowStart = new Date(apiKeyRecord.lastRequest.getTime());
						const windowEnd = new Date(windowStart.getTime() + apiKeyRecord.rateLimitTimeWindow);

						if (now >= windowEnd) {
							// Reset the counter
							updateData.requestCount = 1;
							updateData.remaining = apiKeyRecord.rateLimitMax - 1;
						} else {
							// Decrement remaining, or initialize if null
							const currentRemaining = apiKeyRecord.remaining ?? apiKeyRecord.rateLimitMax;
							updateData.remaining = Math.max(0, currentRemaining - 1);
						}
					}

					db.apiKey
						.update({
							data: updateData,
							where: { id: apiKeyRecord.id }
						})
						.catch((error) => {
							console.error('[TRPC Context] Failed to update API key usage:', error);
						});

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
		// If it's a TRPCError (like TOO_MANY_REQUESTS), rethrow it
		if (error instanceof TRPCError) {
			throw error;
		}

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

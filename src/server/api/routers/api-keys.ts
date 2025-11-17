import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
	calculateExpirationDate,
	checkRateLimit,
	generateApiKey,
	hashApiKey,
	hasPermissions,
	isApiKeyExpired,
	isRefillDue,
	validateApiKeyFormat,
	validatePermissions,
	verifyApiKey
} from '@/lib/api-keys';
import { createTRPCRouter, protectedProcedure, withPermissions } from '@/server/api/trpc';

// Prefix length for API key start comparison
const API_KEY_PREFIX_LENGTH = 10;

// Minimum API key length for validation
const MIN_API_KEY_LENGTH = 32;

// Maximum number of candidate keys to check for API key verification
const MAX_CANDIDATE_KEYS = 20;

// Validation schemas
const permissionsSchema = z.record(z.string(), z.array(z.string())).nullable();

const createApiKeySchema = z.object({
	expiresIn: z
		.number()
		.int()
		.min(60, 'Minimum expiration is 60 seconds')
		.max(365 * 24 * 60 * 60, 'Maximum expiration is 365 days')
		.optional(),
	metadata: z.record(z.string(), z.any()).optional(),
	name: z
		.string()
		.min(1, 'Name must be at least 1 character')
		.max(100, 'Name must be at most 100 characters')
		.optional(),
	permissions: permissionsSchema.optional(),
	prefix: z
		.string()
		.min(2, 'Prefix must be at least 2 characters')
		.max(10, 'Prefix must be at most 10 characters')
		.regex(/^[a-zA-Z0-9_-]+$/, 'Prefix can only contain alphanumeric characters, hyphens, and underscores')
		.optional(),
	rateLimitEnabled: z.boolean().optional(),
	rateLimitMax: z.number().int().positive().optional(),
	rateLimitTimeWindow: z.number().int().positive().optional(),
	refillAmount: z.number().int().positive().optional(),
	refillInterval: z.number().int().positive().optional(),
	remaining: z.number().int().positive().optional()
});

const updateApiKeySchema = z.object({
	enabled: z.boolean().optional(),
	keyId: z.string(),
	metadata: z.record(z.string(), z.any()).optional(),
	name: z.string().min(1).max(100).optional(),
	permissions: permissionsSchema.optional(),
	rateLimitEnabled: z.boolean().optional(),
	rateLimitMax: z.number().int().positive().optional(),
	rateLimitTimeWindow: z.number().int().positive().optional(),
	refillAmount: z.number().int().positive().optional(),
	refillInterval: z.number().int().positive().optional(),
	remaining: z.number().int().nonnegative().optional()
});

const verifyApiKeySchema = z.object({
	key: z.string().min(32, 'Invalid API key'),
	permissions: z.record(z.string(), z.array(z.string())).optional()
});

// This is used to efficiently narrow down candidate API keys before bcrypt comparison.
// Must be >= 6 for reasonable collision avoidance, but not so long as to leak too much key entropy.

export const apiKeysRouter = createTRPCRouter({
	/**
	 * Create a new API key
	 * Requires: apiKeys:write permission
	 */
	create: withPermissions('apiKeys', 'write')
		.input(createApiKeySchema)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			// Validate permissions if provided
			if (input.permissions && !validatePermissions(input.permissions)) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Invalid permissions format'
				});
			}

			// Validate refill configuration
			if ((input.refillAmount && !input.refillInterval) || (!input.refillAmount && input.refillInterval)) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Both refillAmount and refillInterval must be provided together'
				});
			}

			// Validate rate limit configuration
			if (input.rateLimitEnabled) {
				if (!input.rateLimitTimeWindow || !input.rateLimitMax) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message: 'rateLimitTimeWindow and rateLimitMax must be provided when rate limiting is enabled'
					});
				}
			}

			// Generate the API key
			const { key, hashedKey, start } = await generateApiKey(64, input.prefix);

			// Calculate expiration if provided
			const expiresAt = input.expiresIn ? calculateExpirationDate(input.expiresIn) : null;

			// Create the API key in database
			const apiKey = await ctx.db.apiKey.create({
				data: {
					expiresAt,
					key: hashedKey,
					lastRefillAt: input.refillInterval ? new Date() : null,
					metadata: input.metadata ? JSON.stringify(input.metadata) : null,
					name: input.name ?? null,
					permissions: input.permissions ? JSON.stringify(input.permissions) : null,
					prefix: input.prefix ?? null,
					rateLimitEnabled: input.rateLimitEnabled ?? false,
					rateLimitMax: input.rateLimitMax ?? null,
					rateLimitTimeWindow: input.rateLimitTimeWindow ?? null,
					refillAmount: input.refillAmount ?? null,
					refillInterval: input.refillInterval ?? null,
					remaining: input.remaining ?? null,
					start,
					userId
				}
			});

			// Return the key details with the plain key (only time it's shown)
			return {
				...apiKey,
				key, // Plain key - only returned on creation
				metadata: apiKey.metadata ? JSON.parse(apiKey.metadata) : null,
				permissions: apiKey.permissions ? JSON.parse(apiKey.permissions) : null
			};
		}),

	/**
	 * Delete an API key
	 * Requires: apiKeys:delete permission
	 */
	delete: withPermissions('apiKeys', 'delete')
		.input(z.object({ keyId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			// Verify ownership
			const existingKey = await ctx.db.apiKey.findUnique({
				where: { id: input.keyId }
			});

			if (!existingKey) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'API key not found'
				});
			}

			if (existingKey.userId !== userId) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'You do not have access to this API key'
				});
			}

			await ctx.db.apiKey.delete({
				where: { id: input.keyId }
			});

			return { success: true };
		}),

	/**
	 * Delete all expired API keys for the current user
	 * Requires: apiKeys:delete permission
	 */
	deleteExpired: withPermissions('apiKeys', 'delete').mutation(async ({ ctx }) => {
		const userId = ctx.session.user.id;

		const result = await ctx.db.apiKey.deleteMany({
			where: {
				expiresAt: {
					lt: new Date()
				},
				userId
			}
		});

		return { count: result.count };
	}),

	/**
	 * Get a specific API key by ID
	 * Requires: apiKeys:read permission
	 */
	get: withPermissions('apiKeys', 'read')
		.input(z.object({ id: z.string() }))
		.query(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			const apiKey = await ctx.db.apiKey.findUnique({
				select: {
					createdAt: true,
					enabled: true,
					expiresAt: true,
					id: true,
					lastRefillAt: true,
					lastRequest: true,
					metadata: true,
					name: true,
					permissions: true,
					prefix: true,
					rateLimitEnabled: true,
					rateLimitMax: true,
					rateLimitTimeWindow: true,
					refillAmount: true,
					refillInterval: true,
					remaining: true,
					requestCount: true,
					start: true,
					updatedAt: true,
					userId: true
				},
				where: { id: input.id }
			});

			if (!apiKey) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'API key not found'
				});
			}

			// Ensure user owns the key
			if (apiKey.userId !== userId) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'You do not have access to this API key'
				});
			}

			return {
				...apiKey,
				metadata: apiKey.metadata ? JSON.parse(apiKey.metadata) : null,
				permissions: apiKey.permissions ? JSON.parse(apiKey.permissions) : null
			};
		}),

	/**
	 * List all API keys for the current user
	 * Requires: apiKeys:read permission
	 */
	list: withPermissions('apiKeys', 'read').query(async ({ ctx }) => {
		const userId = ctx.session.user.id;

		const apiKeys = await ctx.db.apiKey.findMany({
			orderBy: { createdAt: 'desc' },
			select: {
				createdAt: true,
				enabled: true,
				expiresAt: true,
				id: true,
				lastRefillAt: true,
				lastRequest: true,
				metadata: true,
				name: true,
				permissions: true,
				prefix: true,
				rateLimitEnabled: true,
				rateLimitMax: true,
				rateLimitTimeWindow: true,
				refillAmount: true,
				refillInterval: true,
				remaining: true,
				requestCount: true,
				start: true,
				updatedAt: true
			},
			where: { userId }
		});

		// Parse JSON fields
		return apiKeys.map((key) => ({
			...key,
			metadata: key.metadata ? JSON.parse(key.metadata) : null,
			permissions: key.permissions ? JSON.parse(key.permissions) : null
		}));
	}),

	/**
	 * Update an API key
	 * Requires: apiKeys:write permission
	 */
	update: withPermissions('apiKeys', 'write')
		.input(updateApiKeySchema)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			// Verify ownership
			const existingKey = await ctx.db.apiKey.findUnique({
				where: { id: input.keyId }
			});

			if (!existingKey) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'API key not found'
				});
			}

			if (existingKey.userId !== userId) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'You do not have access to this API key'
				});
			}

			// Validate permissions if provided
			if (input.permissions && !validatePermissions(input.permissions)) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Invalid permissions format'
				});
			}

			// Build update data
			const updateData: Record<string, unknown> = {};
			if (input.name !== undefined) updateData.name = input.name;
			if (input.enabled !== undefined) updateData.enabled = input.enabled;
			if (input.remaining !== undefined) updateData.remaining = input.remaining;
			if (input.refillAmount !== undefined) updateData.refillAmount = input.refillAmount;
			if (input.refillInterval !== undefined) updateData.refillInterval = input.refillInterval;
			if (input.rateLimitEnabled !== undefined) updateData.rateLimitEnabled = input.rateLimitEnabled;
			if (input.rateLimitTimeWindow !== undefined) updateData.rateLimitTimeWindow = input.rateLimitTimeWindow;
			if (input.rateLimitMax !== undefined) updateData.rateLimitMax = input.rateLimitMax;
			if (input.permissions !== undefined)
				updateData.permissions = input.permissions ? JSON.stringify(input.permissions) : null;
			if (input.metadata !== undefined)
				updateData.metadata = input.metadata ? JSON.stringify(input.metadata) : null;

			const updatedKey = await ctx.db.apiKey.update({
				data: updateData,
				select: {
					createdAt: true,
					enabled: true,
					expiresAt: true,
					id: true,
					lastRefillAt: true,
					lastRequest: true,
					metadata: true,
					name: true,
					permissions: true,
					prefix: true,
					rateLimitEnabled: true,
					rateLimitMax: true,
					rateLimitTimeWindow: true,
					refillAmount: true,
					refillInterval: true,
					remaining: true,
					requestCount: true,
					start: true,
					updatedAt: true
				},
				where: { id: input.keyId }
			});

			return {
				...updatedKey,
				metadata: updatedKey.metadata ? JSON.parse(updatedKey.metadata) : null,
				permissions: updatedKey.permissions ? JSON.parse(updatedKey.permissions) : null
			};
		}),

	/**
	 * Verify an API key (can be called without authentication)
	 * Requires: apiKeys:read permission
	 */
	verify: withPermissions('apiKeys', 'read')
		.input(verifyApiKeySchema)
		.mutation(async ({ ctx, input }) => {
			// Validate key format and minimum length
			if (!validateApiKeyFormat(input.key)) {
				return {
					error: { code: 'INVALID_FORMAT', message: 'Invalid API key format' },
					key: null,
					valid: false
				};
			}

			// Find candidate keys by exact start match for efficient lookup
			// Limit the number of candidates to prevent DoS via excessive bcrypt comparisons
			const candidateKeys = await ctx.db.apiKey.findMany({
				include: { user: true },
				take: MAX_CANDIDATE_KEYS,
				where: {
					start: input.key.slice(0, API_KEY_PREFIX_LENGTH)
				}
			});

			// Sequentially compare candidate keys using bcrypt.compare.
			// This is intentional: bcrypt is CPU-intensive and parallelizing could exhaust server resources.
			let matchedKey: (typeof candidateKeys)[0] | null = null;
			for (const candidate of candidateKeys) {
				const isMatch = await verifyApiKey(input.key, candidate.key);
				if (isMatch && !matchedKey) {
					matchedKey = candidate;
				}
			}

			if (!matchedKey) {
				return {
					error: { code: 'NOT_FOUND', message: 'API key not found' },
					key: null,
					valid: false
				};
			}

			// Check if key is enabled
			if (!matchedKey.enabled) {
				return {
					error: { code: 'DISABLED', message: 'API key is disabled' },
					key: null,
					valid: false
				};
			}

			// Check if expired
			if (isApiKeyExpired(matchedKey.expiresAt)) {
				// Delete expired key
				await ctx.db.apiKey.delete({ where: { id: matchedKey.id } });
				return {
					error: { code: 'EXPIRED', message: 'API key has expired' },
					key: null,
					valid: false
				};
			}

			// Check rate limit
			if (matchedKey.rateLimitEnabled) {
				const { exceeded, resetAt } = checkRateLimit(
					matchedKey.requestCount,
					matchedKey.rateLimitMax,
					matchedKey.lastRequest,
					matchedKey.rateLimitTimeWindow
				);

				if (exceeded) {
					return {
						error: {
							code: 'RATE_LIMIT_EXCEEDED',
							message: `Rate limit exceeded. Resets at ${resetAt?.toISOString()}`
						},
						key: null,
						valid: false
					};
				}
			}

			// Check remaining requests
			if (matchedKey.remaining !== null) {
				// Check if refill is due
				if (isRefillDue(matchedKey.lastRefillAt, matchedKey.refillInterval)) {
					const newRemaining = matchedKey.remaining + (matchedKey.refillAmount ?? 0);
					await ctx.db.apiKey.update({
						data: {
							lastRefillAt: new Date(),
							remaining: newRemaining
						},
						where: { id: matchedKey.id }
					});
				}

				if (matchedKey.remaining <= 0) {
					return {
						error: { code: 'NO_REMAINING', message: 'API key has no remaining requests' },
						key: null,
						valid: false
					};
				}
			}

			// Check permissions if required
			if (input.permissions) {
				const keyPermissions = matchedKey.permissions ? JSON.parse(matchedKey.permissions) : null;

				if (!hasPermissions(keyPermissions, input.permissions)) {
					return {
						error: {
							code: 'INSUFFICIENT_PERMISSIONS',
							message: 'API key does not have required permissions'
						},
						key: null,
						valid: false
					};
				}
			}

			// Update usage statistics
			const now = new Date();
			const shouldResetRateLimit =
				matchedKey.rateLimitEnabled &&
				matchedKey.lastRequest &&
				matchedKey.rateLimitTimeWindow &&
				now.getTime() - matchedKey.lastRequest.getTime() >= matchedKey.rateLimitTimeWindow;

			await ctx.db.apiKey.update({
				data: {
					lastRequest: now,
					remaining: matchedKey.remaining !== null ? matchedKey.remaining - 1 : null,
					requestCount: shouldResetRateLimit ? 1 : matchedKey.requestCount + 1
				},
				where: { id: matchedKey.id }
			});

			// Return valid response
			return {
				error: null,
				key: {
					createdAt: matchedKey.createdAt,
					enabled: matchedKey.enabled,
					expiresAt: matchedKey.expiresAt,
					id: matchedKey.id,
					lastRefillAt: matchedKey.lastRefillAt,
					lastRequest: now,
					metadata: matchedKey.metadata ? JSON.parse(matchedKey.metadata) : null,
					name: matchedKey.name,
					permissions: matchedKey.permissions ? JSON.parse(matchedKey.permissions) : null,
					prefix: matchedKey.prefix,
					rateLimitEnabled: matchedKey.rateLimitEnabled,
					rateLimitMax: matchedKey.rateLimitMax,
					rateLimitTimeWindow: matchedKey.rateLimitTimeWindow,
					refillAmount: matchedKey.refillAmount,
					refillInterval: matchedKey.refillInterval,
					remaining: matchedKey.remaining !== null ? matchedKey.remaining - 1 : null,
					requestCount: shouldResetRateLimit ? 1 : matchedKey.requestCount + 1,
					start: matchedKey.start,
					updatedAt: matchedKey.updatedAt,
					userId: matchedKey.userId
				},
				valid: true
			};
		})
});

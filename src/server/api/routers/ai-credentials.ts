import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { isDateApiVersion, maskHint, normalizeBaseUrl, normalizeResourceName } from '@/server/ai/credential-config';
import { open, Secret, seal } from '@/server/ai/crypto';
import { type ListModelsResult, listProviderModels } from '@/server/ai/list-models';
import { type ByokConfig, type ByokProvider, probeCredential } from '@/server/ai/probe';
import { safeProviderErrorMessage } from '@/server/ai/provider-errors';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';

const providerSchema = z.enum(['ANTHROPIC', 'AZURE', 'GOOGLE', 'OPENAI', 'OPENAI_COMPATIBLE']);

// zod v4: `z.url()` is the top-level string-format API. `z.string().url()` is the
// deprecated v3 spelling. Bare `z.url()` imposes NO protocol restriction — it accepts
// `file:///etc/passwd`, `javascript:`, `ftp:` — and `listProviderModels` does a bare
// `fetch()` on this value, which makes an unrestricted URL a local-file read oracle.
// Restrict to http(s) explicitly; `http://localhost:11434` (Ollama) must keep working.
const createInput = z
	.object({
		apiVersion: z.string().max(40).optional(),
		baseURL: z
			.url({ protocol: /^https?$/ })
			.max(500)
			.optional(),
		defaultModelId: z.string().min(1).max(120),
		deployment: z.string().max(120).optional(),
		enabledModelIds: z.array(z.string().min(1).max(120)).min(1).max(100),
		label: z.string().max(60).optional(),
		provider: providerSchema,
		resourceName: z.string().max(120).optional(),
		secret: z.string().min(8).max(500)
	})
	.superRefine((value, ctx) => {
		if (!value.enabledModelIds.includes(value.defaultModelId)) {
			ctx.addIssue({
				code: 'custom',
				message: 'The primary model must be one of the enabled models.',
				path: ['defaultModelId']
			});
		}
		if (value.apiVersion && isDateApiVersion(value.apiVersion)) {
			ctx.addIssue({
				code: 'custom',
				message: "apiVersion must be 'v1' — a date is the old Azure dialect and 404s on the v1 route.",
				path: ['apiVersion']
			});
		}
		if (value.provider === 'AZURE') {
			if (!value.resourceName && !value.baseURL) {
				ctx.addIssue({
					code: 'custom',
					message: 'Azure needs a resource name (or a base URL).',
					path: ['resourceName']
				});
			}
			if (!value.deployment) {
				ctx.addIssue({
					code: 'custom',
					message: 'Azure needs the deployment name — it is the SDK model id.',
					path: ['deployment']
				});
			}
		}
		if (value.provider === 'OPENAI_COMPATIBLE' && !value.baseURL) {
			ctx.addIssue({ code: 'custom', message: 'A base URL is required.', path: ['baseURL'] });
		}
	});

const listModelsInput = z
	.object({
		// Same protocol restriction as `createInput.baseURL`, and for the same reason: this
		// value is fed straight into a `fetch()` inside `listProviderModels`.
		baseURL: z
			.url({ protocol: /^https?$/ })
			.max(500)
			.optional(),
		provider: providerSchema,
		secret: z.string().min(8).max(500)
	})
	.superRefine((value, ctx) => {
		if (value.provider === 'OPENAI_COMPATIBLE' && !value.baseURL) {
			ctx.addIssue({ code: 'custom', message: 'A base URL is required.', path: ['baseURL'] });
		}
	});

const storedProviderInput = z.object({ provider: providerSchema });

const updateModelsInput = z
	.object({
		defaultModelId: z.string().min(1).max(120),
		enabledModelIds: z.array(z.string().min(1).max(120)).min(1).max(100),
		provider: providerSchema
	})
	.superRefine((value, ctx) => {
		if (!value.enabledModelIds.includes(value.defaultModelId)) {
			ctx.addIssue({
				code: 'custom',
				message: 'The primary model must be one of the enabled models.',
				path: ['defaultModelId']
			});
		}
	});

/** What the client is ever allowed to see. The secret is NEVER in this shape. */
export type AiCredentialView = {
	createdAt: Date;
	defaultModelId: string;
	deployment: string | null;
	enabled: boolean;
	enabledModelIds: string[];
	hint: string | null;
	id: string;
	label: string | null;
	lastUsedAt: Date | null;
	lastVerifiedAt: Date | null;
	provider: ByokProvider;
	resourceName: string | null;
};

/**
 * `seal()` throws for two structurally different reasons: input validation (empty/
 * delimiter-containing userId or provider, empty plaintext) and server misconfiguration
 * (the sealing keyring is unset or malformed). Only the FIRST category is the caller's
 * fault — mis-mapping the second to a form error would tell a user "fix your input" for
 * a problem their input cannot fix. `ctx.session.user.id` is a Better Auth cuid and
 * `provider` is a zod enum, so this should be unreachable in practice, but Task 3's own
 * guard exists precisely because "should be unreachable" is not a proof.
 */
function isCredentialInputError(error: unknown): boolean {
	return error instanceof Error && /must not be empty|delimiter/.test(error.message);
}

/**
 * Load the caller's OWN enabled credential for a provider and decrypt its secret.
 *
 * This is what lets the edit flow work without the browser re-sending the key: the plaintext
 * exists only inside this request. Scoped by `userId`, so a provider the caller does not own is
 * a NOT_FOUND rather than another tenant's row.
 *
 * A decrypt failure is NOT "this row is corrupt, delete it" — the sealing key may simply have
 * been retired from the keyring. Surface it as an actionable precondition instead.
 */
async function loadOwnCredential(db: typeof import('@/server/db').db, userId: string, provider: ByokProvider) {
	const row = await db.aiProviderCredential.findFirst({ where: { enabled: true, provider, userId } });
	if (row === null) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'No saved key for this provider.' });
	}
	try {
		const secret = open(
			{ authTag: row.authTag, ciphertext: row.ciphertext, iv: row.iv, kid: row.kid },
			userId,
			provider
		);
		return { row, secret };
	} catch {
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message: 'This key cannot be read — the encryption key that sealed it was retired. Re-add the key.'
		});
	}
}

export const aiCredentialsRouter = createTRPCRouter({
	/**
	 * Create (or replace) the credential for a provider.
	 * VALIDATES ON SAVE with a live probe, then seals. An unverified credential
	 * is never persisted.
	 */
	create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }): Promise<AiCredentialView> => {
		const userId = ctx.session.user.id;

		const config: ByokConfig = {
			apiVersion: input.apiVersion ?? null,
			baseURL: input.baseURL ? normalizeBaseUrl(input.baseURL) : null,
			defaultModelId: input.defaultModelId,
			deployment: input.deployment ?? null,
			provider: input.provider,
			resourceName: input.resourceName ? normalizeResourceName(input.resourceName) : null
		};

		const secret = new Secret(input.secret);
		const probe = await probeCredential(config, secret);
		if (!probe.ok) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: `The provider rejected this credential: ${probe.error}`
			});
		}

		let blob: ReturnType<typeof seal>;
		try {
			blob = seal(secret.expose(), userId, input.provider);
		} catch (error) {
			if (isCredentialInputError(error)) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `Could not save this credential: ${error instanceof Error ? error.message : 'invalid input'}`
				});
			}
			throw error;
		}

		// Prisma 7's generated `Bytes` input type is `Uint8Array<ArrayBuffer>`, but `seal()`'s
		// output (via `Buffer.concat`) is typed `Uint8Array<ArrayBufferLike>` — TS's stricter
		// typed-array generics (see crypto.test.ts's "raw Uint8Array (the Prisma Bytes shape)"
		// test, which establishes this same `new Uint8Array(x)` idiom) reject the wider type
		// without a copy.
		const authTag = new Uint8Array(blob.authTag);
		const ciphertext = new Uint8Array(blob.ciphertext);
		const iv = new Uint8Array(blob.iv);

		const row = await ctx.db.aiProviderCredential.upsert({
			create: {
				apiVersion: config.apiVersion,
				authTag,
				baseURL: config.baseURL,
				ciphertext,
				defaultModelId: config.defaultModelId,
				deployment: config.deployment,
				enabledModelIds: input.enabledModelIds,
				iv,
				kid: blob.kid,
				label: input.label ?? null,
				lastVerifiedAt: new Date(),
				provider: input.provider,
				resourceName: config.resourceName,
				userId
			},
			update: {
				apiVersion: config.apiVersion,
				authTag,
				baseURL: config.baseURL,
				ciphertext,
				defaultModelId: config.defaultModelId,
				deployment: config.deployment,
				enabled: true,
				enabledModelIds: input.enabledModelIds,
				iv,
				kid: blob.kid,
				label: input.label ?? null,
				lastVerifiedAt: new Date(),
				resourceName: config.resourceName
			},
			where: { userId_provider: { provider: input.provider, userId } }
		});

		return {
			createdAt: row.createdAt,
			defaultModelId: row.defaultModelId,
			deployment: row.deployment,
			enabled: row.enabled,
			enabledModelIds: row.enabledModelIds,
			hint: maskHint(input.secret),
			id: row.id,
			label: row.label,
			lastUsedAt: row.lastUsedAt,
			lastVerifiedAt: row.lastVerifiedAt,
			provider: row.provider,
			resourceName: row.resourceName
		};
	}),

	/** deleteMany scoped by userId: a credential id belonging to another tenant matches nothing. */
	delete: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }): Promise<{ deleted: number }> => {
			const result = await ctx.db.aiProviderCredential.deleteMany({
				where: { id: input.id, userId: ctx.session.user.id }
			});
			if (result.count === 0) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' });
			}
			return { deleted: result.count };
		}),

	/**
	 * The secret NEVER leaves the server. We decrypt only to derive the last-4 hint;
	 * if the sealing key has been retired from the keyring, the hint is null and the
	 * row shows as unusable rather than pretending to work.
	 *
	 * `open()` throwing does NOT mean "this row is corrupt, delete it" — it can throw
	 * for a retired kid, a tampered blob, OR an input-validation bug in `open()` itself.
	 * The only safe reaction to ANY of those is to show the row as unreadable; deleting
	 * on the strength of a decrypt failure would destroy a perfectly good row the moment
	 * a validation bug (not a corruption) tripped this catch.
	 */
	list: protectedProcedure.query(async ({ ctx }): Promise<AiCredentialView[]> => {
		const userId = ctx.session.user.id;
		const rows = await ctx.db.aiProviderCredential.findMany({
			orderBy: { createdAt: 'desc' },
			where: { userId }
		});

		return rows.map((row) => {
			let hint: string | null = null;
			try {
				hint = maskHint(
					open(
						{ authTag: row.authTag, ciphertext: row.ciphertext, iv: row.iv, kid: row.kid },
						userId,
						row.provider
					).expose()
				);
			} catch {
				hint = null;
			}
			return {
				createdAt: row.createdAt,
				defaultModelId: row.defaultModelId,
				deployment: row.deployment,
				enabled: row.enabled,
				enabledModelIds: row.enabledModelIds,
				hint,
				id: row.id,
				label: row.label,
				lastUsedAt: row.lastUsedAt,
				lastVerifiedAt: row.lastVerifiedAt,
				provider: row.provider,
				resourceName: row.resourceName
			};
		});
	}),

	/**
	 * List the models a provider offers, using the key the user has just typed — the
	 * credential row does not exist yet, so this cannot go through `resolveModel`.
	 *
	 * Persists NOTHING. Errors are redacted before they reach the browser: a provider
	 * error can embed the request config, including the auth header.
	 */
	listModels: protectedProcedure.input(listModelsInput).mutation(async ({ input }): Promise<ListModelsResult> => {
		try {
			return await listProviderModels({
				baseURL: input.baseURL ?? null,
				provider: input.provider,
				secret: input.secret
			});
		} catch (error) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: `Could not list models: ${safeProviderErrorMessage(error, input.secret)}`
			});
		}
	}),

	/**
	 * List a SAVED credential's available models, using the stored key. The browser never sends
	 * the secret for an existing credential — it does not have it. Persists nothing.
	 */
	listStoredModels: protectedProcedure
		.input(storedProviderInput)
		.mutation(async ({ ctx, input }): Promise<ListModelsResult> => {
			const { row, secret } = await loadOwnCredential(ctx.db, ctx.session.user.id, input.provider);
			try {
				return await listProviderModels({
					baseURL: row.baseURL,
					provider: input.provider,
					secret: secret.expose()
				});
			} catch (error) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `Could not list models: ${safeProviderErrorMessage(error, secret.expose())}`
				});
			}
		}),

	/**
	 * Change which models a saved credential serves, without touching the key.
	 *
	 * The NEW primary is probed with the stored secret, so choosing a model this key cannot serve
	 * fails here rather than mid-conversation. Only the primary is probed — enabling N models must
	 * not cost N provider calls.
	 */
	updateModels: protectedProcedure
		.input(updateModelsInput)
		.mutation(async ({ ctx, input }): Promise<AiCredentialView> => {
			const { row, secret } = await loadOwnCredential(ctx.db, ctx.session.user.id, input.provider);

			const config: ByokConfig = {
				apiVersion: row.apiVersion,
				baseURL: row.baseURL,
				defaultModelId: input.defaultModelId,
				deployment: row.deployment,
				provider: input.provider,
				resourceName: row.resourceName
			};
			const probe = await probeCredential(config, secret);
			if (!probe.ok) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `The provider rejected this model: ${probe.error}`
				});
			}

			// `row` was already scoped by userId, so updating by its id cannot cross tenants.
			const updated = await ctx.db.aiProviderCredential.update({
				data: {
					defaultModelId: input.defaultModelId,
					enabledModelIds: input.enabledModelIds,
					lastVerifiedAt: new Date()
				},
				where: { id: row.id }
			});

			return {
				createdAt: updated.createdAt,
				defaultModelId: updated.defaultModelId,
				deployment: updated.deployment,
				enabled: updated.enabled,
				enabledModelIds: updated.enabledModelIds,
				hint: maskHint(secret.expose()),
				id: updated.id,
				label: updated.label,
				lastUsedAt: updated.lastUsedAt,
				lastVerifiedAt: updated.lastVerifiedAt,
				provider: updated.provider,
				resourceName: updated.resourceName
			};
		})
});

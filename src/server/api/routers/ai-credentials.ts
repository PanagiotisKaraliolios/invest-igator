import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { isDateApiVersion, maskHint, normalizeBaseUrl, normalizeResourceName } from '@/server/ai/credential-config';
import { open, Secret, seal } from '@/server/ai/crypto';
import { type ByokConfig, type ByokProvider, probeCredential } from '@/server/ai/probe';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';

const providerSchema = z.enum(['ANTHROPIC', 'AZURE', 'GOOGLE', 'OPENAI', 'OPENAI_COMPATIBLE']);

// zod v4: `z.url()` is the top-level string-format API. `z.string().url()` is the
// deprecated v3 spelling.
const createInput = z
	.object({
		apiVersion: z.string().max(40).optional(),
		baseURL: z.url().max(500).optional(),
		defaultModelId: z.string().min(1).max(120),
		deployment: z.string().max(120).optional(),
		label: z.string().max(60).optional(),
		provider: providerSchema,
		resourceName: z.string().max(120).optional(),
		secret: z.string().min(8).max(500)
	})
	.superRefine((value, ctx) => {
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

/** What the client is ever allowed to see. The secret is NEVER in this shape. */
export type AiCredentialView = {
	createdAt: Date;
	defaultModelId: string;
	deployment: string | null;
	enabled: boolean;
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
				hint,
				id: row.id,
				label: row.label,
				lastUsedAt: row.lastUsedAt,
				lastVerifiedAt: row.lastVerifiedAt,
				provider: row.provider,
				resourceName: row.resourceName
			};
		});
	})
});

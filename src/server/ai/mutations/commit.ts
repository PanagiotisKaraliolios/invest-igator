import { TRPCError } from '@trpc/server';
import { createTransactionInput } from '@/server/api/routers/transactions.schemas';
import { db } from '@/server/db';
import { invalidatePortfolioCache } from '@/server/portfolio-compute';
import { createTransaction } from '@/server/services/transactions';
import { verifyMutation } from './token';

/**
 * The one write trigger. Verifies the signed token (signature-then-expiry), enforces the token is
 * non-transferable (`payload.userId === sessionUserId`), then — atomically — burns the single-use
 * `jti` and writes the transaction; a replay collides on the `jti` PK and the whole transaction
 * rolls back. Yahoo is NOT re-run: the token is the tool's signed validation attestation. Cache is
 * invalidated after the commit. `now` is injectable for tests.
 */
export async function commitPendingTransaction(deps: {
	token: string;
	sessionUserId: string;
	secret: string;
	now?: number;
}): Promise<{ id: string }> {
	const v = verifyMutation(deps.token, deps.secret, deps.now);
	if (!v.ok) {
		throw new TRPCError({
			code: v.reason === 'EXPIRED' ? 'TIMEOUT' : 'BAD_REQUEST',
			message:
				v.reason === 'EXPIRED'
					? 'This confirmation expired. Ask me to prepare it again.'
					: 'Invalid confirmation.'
		});
	}
	if (v.payload.userId !== deps.sessionUserId) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'This confirmation does not belong to you.' });
	}
	if (v.payload.tool !== 'transactions.create') {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unsupported confirmation.' });
	}
	const args = createTransactionInput.parse(v.payload.args);

	let id: string;
	try {
		id = (
			await db.$transaction(async (tx) => {
				await tx.aiMutationCommit.create({
					data: { jti: v.payload.jti, tool: v.payload.tool, userId: deps.sessionUserId }
				});
				return createTransaction(deps.sessionUserId, args, tx);
			})
		).id;
	} catch (err) {
		if ((err as { code?: unknown } | null)?.code === 'P2002') {
			throw new TRPCError({ code: 'CONFLICT', message: 'This transaction was already recorded.' });
		}
		throw err;
	}
	await invalidatePortfolioCache(deps.sessionUserId);
	return { id };
}

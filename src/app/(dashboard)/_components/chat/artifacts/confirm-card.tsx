'use client';

import { type ReactNode, useState } from 'react';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
// `import type` only — erased at compile time, so the tool module (and its `@/server/db` /
// `@/env` import chain) never enters the client bundle. Same boundary trick as data-table-artifact.
import type { transactionsCreateTool } from '@/server/ai/tools/transactions-create';
import { api } from '@/trpc/react';
import { isExpired } from './confirm-card.helpers';

/** The tool's confirm-branch output — the only shape this card renders. */
type ConfirmOutput = Extract<z.infer<typeof transactionsCreateTool.outputSchema>, { requiresConfirmation: true }>;

/**
 * The first INTERACTIVE chat artifact: a read-only preview of a transaction the `transactions.create`
 * tool proposed, with Confirm / Cancel. Confirm fires the session-authenticated commit mutation with
 * the exact signed token — the LLM never triggers the write. To change anything, the user tells the
 * assistant, which produces a fresh preview + token.
 */
export function ConfirmCard({ output }: { output: unknown }): ReactNode {
	const o = output as { requiresConfirmation?: boolean };
	// The error branch (requiresConfirmation === false) is relayed by the model as text — render nothing.
	const isConfirmBranch = !!o && o.requiresConfirmation === true;

	const utils = api.useUtils();
	const [cancelled, setCancelled] = useState(false);
	const commit = api.aiChat.commitPendingTransaction.useMutation({
		onSuccess: () => {
			// Refresh anything showing transactions / portfolio value.
			void utils.invalidate();
		}
	});

	if (!isConfirmBranch) return null;
	const out = output as ConfirmOutput;
	const p = out.proposed;

	if (cancelled) return <p className='text-muted-foreground text-xs'>Cancelled — nothing was recorded.</p>;
	if (commit.isSuccess) {
		return (
			<p className='text-xs'>
				✓ Recorded {p.side === 'BUY' ? 'buy' : 'sell'} of {p.quantity} {p.symbol}.
			</p>
		);
	}

	const expired = isExpired(out.expiresAt);

	return (
		<div className='space-y-2'>
			<div className='text-sm'>
				<span className='font-medium'>{p.side === 'BUY' ? 'Buy' : 'Sell'}</span> {p.quantity}{' '}
				<span className='font-medium'>{p.symbol}</span>
				{out.description ? <span className='text-muted-foreground'> ({out.description})</span> : null} @{' '}
				{p.price} {p.priceCurrency} on {p.date}
				{p.fee ? (
					<span className='text-muted-foreground'>
						{' '}
						· fee {p.fee} {p.feeCurrency ?? p.priceCurrency}
					</span>
				) : null}
				{p.note ? <span className='text-muted-foreground'> · {p.note}</span> : null}
			</div>
			{expired ? (
				<p className='text-muted-foreground text-xs'>This confirmation expired — ask me to prepare it again.</p>
			) : (
				<div className='flex gap-2'>
					<Button
						disabled={commit.isPending}
						onClick={() => commit.mutate({ token: out.confirmationToken })}
						size='sm'
						type='button'
					>
						{commit.isPending ? 'Recording…' : 'Confirm'}
					</Button>
					<Button
						disabled={commit.isPending}
						onClick={() => setCancelled(true)}
						size='sm'
						type='button'
						variant='secondary'
					>
						Cancel
					</Button>
				</div>
			)}
			{commit.isError ? <p className='text-destructive text-xs'>{commit.error.message}</p> : null}
		</div>
	);
}

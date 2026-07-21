'use client';

import type { z } from 'zod';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/currency';
// `import type` only — erased at compile time, so these server tool modules (and their
// `@/server/db` import chains) never enter the client bundle. See registry.ts's boundary note.
import type { fxRatesTool } from '@/server/ai/tools/fx-rates';
import type { goalsListTool } from '@/server/ai/tools/goals-list';
import type { transactionsSearchTool } from '@/server/ai/tools/transactions-search';
import type { watchlistListTool } from '@/server/ai/tools/watchlist-list';

type FxRatesOutput = z.infer<typeof fxRatesTool.outputSchema>;
type GoalsListOutput = z.infer<typeof goalsListTool.outputSchema>;
type TransactionsSearchOutput = z.infer<typeof transactionsSearchTool.outputSchema>;
type WatchlistListOutput = z.infer<typeof watchlistListTool.outputSchema>;

type Props =
	| { kind: 'fx.rates'; output: FxRatesOutput }
	| { kind: 'goals.list'; output: GoalsListOutput }
	| { kind: 'transactions.search'; output: TransactionsSearchOutput }
	| { kind: 'watchlist.list'; output: WatchlistListOutput };

function EmptyNote() {
	return <p className='text-muted-foreground text-xs'>No data to show.</p>;
}

function MoreNote() {
	return <p className='text-muted-foreground text-xs'>More results exist — showing a partial list.</p>;
}

/**
 * A compact table over each list-shaped tool's output. Column set and field names come straight
 * from the tool's `outputSchema` (see the imports above) — never from model-generated prose.
 */
export function DataTableArtifact(props: Props) {
	switch (props.kind) {
		case 'fx.rates': {
			const rows = Object.entries(props.output.rates);
			if (rows.length === 0) return <EmptyNote />;
			return (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Currency</TableHead>
							<TableHead className='text-right'>Rate (1 {props.output.base} =)</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map(([quote, rate]) => (
							<TableRow key={quote}>
								<TableCell>{quote}</TableCell>
								<TableCell className='text-right font-mono tabular-nums'>{rate.toFixed(4)}</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			);
		}
		case 'goals.list': {
			if (props.output.goals.length === 0) return <EmptyNote />;
			return (
				<>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Goal</TableHead>
								<TableHead className='text-right'>Target</TableHead>
								<TableHead>Target date</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{props.output.goals.map((g) => (
								<TableRow key={g.id}>
									<TableCell>{g.title}</TableCell>
									<TableCell className='text-right font-mono tabular-nums'>
										{formatCurrency(g.targetAmount, g.targetCurrency, 0)}
									</TableCell>
									<TableCell>{g.targetDate ?? '—'}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
					{props.output.hasMore && <MoreNote />}
				</>
			);
		}
		case 'transactions.search': {
			if (props.output.transactions.length === 0) return <EmptyNote />;
			return (
				<>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Date</TableHead>
								<TableHead>Symbol</TableHead>
								<TableHead>Side</TableHead>
								<TableHead className='text-right'>Qty</TableHead>
								<TableHead className='text-right'>Price</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{props.output.transactions.map((t) => (
								<TableRow key={t.id}>
									<TableCell>{t.date}</TableCell>
									<TableCell>{t.symbol}</TableCell>
									<TableCell>{t.side}</TableCell>
									<TableCell className='text-right font-mono tabular-nums'>{t.quantity}</TableCell>
									<TableCell className='text-right font-mono tabular-nums'>
										{formatCurrency(t.price, t.priceCurrency, 2)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
					{props.output.hasMore && <MoreNote />}
				</>
			);
		}
		case 'watchlist.list': {
			if (props.output.items.length === 0) return <EmptyNote />;
			return (
				<>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Symbol</TableHead>
								<TableHead>Description</TableHead>
								<TableHead>Currency</TableHead>
								<TableHead>Starred</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{props.output.items.map((it) => (
								<TableRow key={it.symbol}>
									<TableCell>{it.displaySymbol ?? it.symbol}</TableCell>
									<TableCell>{it.description ?? '—'}</TableCell>
									<TableCell>{it.currency}</TableCell>
									<TableCell>{it.starred ? '★' : ''}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
					{props.output.hasMore && <MoreNote />}
				</>
			);
		}
		default:
			return null;
	}
}

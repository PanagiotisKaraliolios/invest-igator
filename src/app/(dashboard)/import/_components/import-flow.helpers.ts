import type { Currency } from '@/lib/currency';
import type { RouterInputs, RouterOutputs } from '@/trpc/react';

type ReviewRow = RouterOutputs['aiImport']['preview']['rows'][number];

/** A preview row plus the review table's local "include in this import" checkbox state. */
export type ReviewRowWithInclude = ReviewRow & { include: boolean };

/**
 * The exact row shape `api.transactions.bulkImport` accepts, derived from the router itself
 * (not the server's `createTransactionInput` zod type — that type is the *parsed* output, where
 * `date` is a `Date`; the wire input `bulkImport.mutate()` actually expects is the pre-parse
 * shape, where `date` is still the `yyyy-mm-dd` string this module produces).
 */
export type CreateTransactionInput = RouterInputs['transactions']['bulkImport']['rows'][number];

/**
 * Reduces the review table's rows to the payload for `transactions.bulkImport`: only rows the
 * user left checked AND that passed preview validation. `needs-fix` rows are excluded even if
 * somehow checked — they have no trustworthy numeric/date values yet, and the server would only
 * reject them again (this just avoids sending known-bad rows). Numeric fields are coerced with
 * `Number(...)`; optional fields collapse an empty string to `undefined` so the server's
 * `.optional()` zod fields see "not provided" rather than `''`. `side`/currencies are cast, not
 * validated — `bulkImport` re-runs every row through the same validator the CSV importer uses,
 * so a bad edit here surfaces as a per-row server error rather than a silent bad write.
 */
export function toBulkImportRows(rows: ReviewRowWithInclude[]): CreateTransactionInput[] {
	return rows
		.filter((r) => r.include && r.status !== 'needs-fix')
		.map((r) => {
			const { date, fee, feeCurrency, note, price, priceCurrency, quantity, side, symbol } = r.values;
			return {
				date,
				fee: fee ? Number(fee) : undefined,
				feeCurrency: feeCurrency ? (feeCurrency as Currency) : undefined,
				note: note || undefined,
				price: Number(price),
				priceCurrency: (priceCurrency || 'USD') as Currency,
				quantity: Number(quantity),
				side: side as 'BUY' | 'SELL',
				symbol
			};
		});
}

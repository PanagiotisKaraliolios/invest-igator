import { z } from 'zod';
import { currencySchema } from '@/lib/currency';
import { isoDateSchema } from '@/lib/date';
import { symbolSchema } from '@/lib/validation';

/**
 * Input schemas for the transaction write mutations.
 *
 * These live apart from the router so they can be tested directly: importing the router
 * pulls in `@/env` and a module-scope InfluxDB client, neither of which exists when the
 * unit tests run. Keeping this module free of side effects is what lets a test assert on
 * the mutations' real validation rather than on a schema they merely ought to be using.
 */

export const createTransactionInput = z.object({
	date: isoDateSchema,
	fee: z.number().optional(),
	feeCurrency: currencySchema.optional(),
	note: z.string().optional(),
	price: z.number(),
	priceCurrency: currencySchema.default('USD'),
	quantity: z.number(),
	side: z.enum(['BUY', 'SELL']),
	symbol: symbolSchema
});

export const updateTransactionInput = z.object({
	date: isoDateSchema.optional(),
	fee: z.number().nullable().optional(),
	feeCurrency: currencySchema.nullable().optional(),
	id: z.string().min(1),
	note: z.string().nullable().optional(),
	price: z.number().optional(),
	priceCurrency: currencySchema.optional(),
	quantity: z.number().optional(),
	side: z.enum(['BUY', 'SELL']).optional(),
	symbol: symbolSchema.optional()
});

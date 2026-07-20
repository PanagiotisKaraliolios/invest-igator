import { z } from 'zod';
import { currencySchema, SUPPORTED_CURRENCIES } from '@/lib/currency';
import { getFxMatrix } from '@/server/fx-history';
import type { AppTool } from './types';

const inputSchema = z.strictObject({
	base: currencySchema.optional().describe("Defaults to the user's display currency.")
});

const outputSchema = z.strictObject({
	base: currencySchema,
	/** base -> quote. Only SUPPORTED_CURRENCIES appear — a small, fixed set, so no size bound is needed. */
	rates: z.record(z.string(), z.number())
});

export const fxRatesTool: AppTool<typeof inputSchema, typeof outputSchema> = {
	annotations: { openWorldHint: false, readOnlyHint: true, title: 'FX rates' },
	description:
		'Latest foreign-exchange rates from a base currency to every supported currency. Use this to convert amounts between currencies.',
	execute: async (input, ctx) => {
		const base = input.base ?? ctx.currency;
		const matrix = await getFxMatrix();
		const row = matrix[base];
		if (!row) return { base, rates: {} };

		const rates: Record<string, number> = {};
		for (const quote of SUPPORTED_CURRENCIES) {
			const rate = row[quote];
			if (typeof rate === 'number' && Number.isFinite(rate)) {
				rates[quote] = rate;
			}
		}
		return { base, rates };
	},
	inputSchema,
	mutates: false,
	name: 'fx.rates',
	outputSchema,
	requiredScope: 'fx:read'
};

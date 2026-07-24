import { z } from 'zod';

export const REQUIRED_FIELDS = ['date', 'symbol', 'side', 'quantity', 'price'] as const;
export type DateFormat = 'ISO' | 'MDY_SLASH' | 'DMY_SLASH' | 'DMY_DOT';

// Azure strict JSON-schema mode: every property present, optionals via `.nullable()`, no records,
// no `.default()` in the model schema. `sideMap` is an array (not a record) for the same reason.
const idx = z.number().int().min(0).nullable();
export const columnMappingSchema = z.object({
	date: idx,
	dateFormat: z.enum(['ISO', 'MDY_SLASH', 'DMY_SLASH', 'DMY_DOT']),
	fee: idx,
	feeCurrency: idx,
	note: idx,
	price: idx,
	priceCurrency: idx,
	quantity: idx,
	side: idx,
	sideMap: z.array(z.object({ from: z.string(), to: z.enum(['BUY', 'SELL']) })),
	symbol: idx
});
export type ColumnMapping = z.infer<typeof columnMappingSchema>;

export function reformatDate(raw: string, fmt: DateFormat): string {
	const s = raw.trim();
	if (fmt === 'ISO') return s;
	const m = s.match(/^(\d{1,4})[/.](\d{1,2})[/.](\d{1,4})$/);
	if (!m) return s;
	const [, a, b, c] = m as unknown as [string, string, string, string];
	const pad = (x: string) => x.padStart(2, '0');
	if (fmt === 'MDY_SLASH') return `${c}-${pad(a)}-${pad(b)}`; // month/day/year
	return `${c}-${pad(b)}-${pad(a)}`; // DMY_SLASH & DMY_DOT: day/month/year
}

// Canonical column order MUST match CANONICAL_HEADER in transaction-import.ts.
export const CANONICAL = [
	'date',
	'symbol',
	'side',
	'quantity',
	'price',
	'priceCurrency',
	'fee',
	'feeCurrency',
	'note'
] as const;

export function applyMapping(dataRows: string[][], mapping: ColumnMapping): string[][] {
	const sideLookup = new Map(mapping.sideMap.map((m) => [m.from.trim().toUpperCase(), m.to]));
	const at = (row: string[], i: number | null) => (i == null ? '' : (row[i] ?? ''));
	return dataRows.map((row) => {
		const rawSide = at(row, mapping.side).trim().toUpperCase();
		return [
			reformatDate(at(row, mapping.date), mapping.dateFormat),
			at(row, mapping.symbol),
			sideLookup.get(rawSide) ?? rawSide, // fall through raw; validateRow enforces BUY/SELL
			at(row, mapping.quantity),
			at(row, mapping.price),
			at(row, mapping.priceCurrency),
			at(row, mapping.fee),
			at(row, mapping.feeCurrency),
			at(row, mapping.note)
		];
	});
}

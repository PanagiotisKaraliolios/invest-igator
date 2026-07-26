import { TRPCError } from '@trpc/server';
import { type Currency, SUPPORTED_CURRENCIES } from '@/lib/currency';
import { parseIsoDateUtc } from '@/lib/date';
import { isValidSymbol as isValidSymbolFormat, normalizeSymbol } from '@/lib/validation';
import { db } from '@/server/db';
import { sleep } from '@/server/jobs/yahoo-lib';
import { symbolExistsOnYahoo } from '@/server/yahoo-search';

export const CANONICAL_HEADER = [
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
export const CSV_NEW_SYMBOL_LIMIT = 50;
const supportedCurrencies = SUPPORTED_CURRENCIES;
const supportedCurrencySet = new Set(supportedCurrencies);

export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let current = '';
	let inQuotes = false;
	let row: string[] = [];
	for (let i = 0; i < text.length; i++) {
		const char = text[i]!;
		if (char === '"') {
			if (inQuotes && text[i + 1] === '"') {
				current += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (char === ',' && !inQuotes) {
			row.push(current);
			current = '';
		} else if ((char === '\n' || char === '\r') && !inQuotes) {
			if (char === '\r' && text[i + 1] === '\n') {
				i++;
			}
			row.push(current);
			if (row.some((cell) => cell.trim() !== '')) {
				rows.push(row);
			}
			row = [];
			current = '';
		} else {
			current += char;
		}
	}
	if (current !== '' || row.length > 0) {
		row.push(current);
		if (row.some((cell) => cell.trim() !== '')) {
			rows.push(row);
		}
	}
	return rows;
}

export function normalizeHeader(row: string[]): string[] {
	const alias: Record<string, string> = {
		currency: 'priceCurrency',
		date: 'date',
		fee: 'fee',
		feecurrency: 'feeCurrency',
		fees: 'fee',
		note: 'note',
		notes: 'note',
		price: 'price',
		pricecurrency: 'priceCurrency',
		qty: 'quantity',
		quantity: 'quantity',
		side: 'side',
		symbol: 'symbol'
	};
	return row.map((cell) => {
		const normalized = cell
			.trim()
			.toLowerCase()
			.replace(/[^a-z]/g, '');
		return alias[normalized] ?? cell.trim();
	});
}

export function createDefaultHeader(length: number): string[] {
	const defaults = ['date', 'symbol', 'side', 'quantity', 'price', 'priceCurrency', 'fee', 'feeCurrency', 'note'];
	return defaults.slice(0, length);
}

export function toDateOnlyISOString(date: Date): string {
	return date.toISOString().slice(0, 10);
}

export function normalizeFeeCurrencyValue(
	fee: number | null,
	feeCurrency: Currency | null,
	priceCurrency: Currency
): Currency | null {
	if (fee == null) return null;
	return feeCurrency ?? priceCurrency;
}

type DuplicateKeyPayload = {
	date: Date;
	fee: number | null;
	feeCurrency: Currency | null;
	note?: string | null;
	price: number;
	priceCurrency: Currency;
	quantity: number;
	side: 'BUY' | 'SELL';
	symbol: string;
};

export function makeDuplicateKey(record: DuplicateKeyPayload): string {
	const feeCurrency = normalizeFeeCurrencyValue(record.fee, record.feeCurrency, record.priceCurrency);
	const feePart = record.fee != null ? String(record.fee) : '';
	const feeCurrencyPart = feeCurrency ?? '';
	return [
		toDateOnlyISOString(record.date),
		record.symbol,
		record.side,
		String(record.quantity),
		String(record.price),
		record.priceCurrency,
		feePart,
		feeCurrencyPart
	].join('|');
}

export type CanonicalRecord = {
	date: Date;
	fee: number | null;
	feeCurrency: Currency | null;
	note: string | null;
	price: number;
	priceCurrency: Currency;
	quantity: number;
	side: 'BUY' | 'SELL';
	symbol: string;
};

/**
 * Per-row validation — the exact body of importCsv's forEach try-block, lifted into a pure
 * function so both the classic importer and the AI preview classify a row identically.
 * `cells` is ordered by `headerMap`; `unknownSymbols` holds symbols Yahoo definitively rejected.
 */
export function validateRow(
	cells: string[],
	headerMap: Map<string, number>,
	unknownSymbols: Set<string>
): { ok: true; record: CanonicalRecord } | { ok: false; message: string } {
	const byColumn = (name: string) => {
		const idx = headerMap.get(name);
		return idx != null ? (cells[idx] ?? '') : '';
	};
	try {
		const symbol = normalizeSymbol(byColumn('symbol'));
		if (!symbol) throw new Error('Symbol is required.');
		if (!isValidSymbolFormat(symbol)) throw new Error('Symbol contains invalid characters.');
		if (unknownSymbols.has(symbol)) throw new Error(`Unknown symbol "${symbol}" — not found on Yahoo Finance.`);

		const sideRaw = byColumn('side').trim().toUpperCase();
		if (sideRaw !== 'BUY' && sideRaw !== 'SELL') throw new Error('Side must be BUY or SELL.');

		const quantity = Number(byColumn('quantity'));
		if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantity must be a positive number.');

		const price = Number(byColumn('price'));
		if (!Number.isFinite(price) || price <= 0) throw new Error('Price must be a positive number.');

		const priceCurrencyRaw = byColumn('priceCurrency').trim().toUpperCase() || 'USD';
		if (!supportedCurrencySet.has(priceCurrencyRaw as Currency)) {
			throw new Error(`Unsupported price currency "${priceCurrencyRaw}".`);
		}

		let feeCurrency: Currency | null = null;
		const feeCurrencyValue = byColumn('feeCurrency').trim().toUpperCase();
		if (feeCurrencyValue) {
			if (!supportedCurrencySet.has(feeCurrencyValue as Currency)) {
				throw new Error(`Unsupported fee currency "${feeCurrencyValue}".`);
			}
			feeCurrency = feeCurrencyValue as Currency;
		}

		const feeRaw = byColumn('fee').trim();
		let fee: number | null = null;
		if (feeRaw !== '') {
			const parsedFee = Number(feeRaw);
			if (!Number.isFinite(parsedFee) || parsedFee < 0) throw new Error('Fee must be a positive number.');
			fee = parsedFee;
			if (!feeCurrency) feeCurrency = priceCurrencyRaw as Currency;
		}

		const noteRaw = byColumn('note').trim();
		const dateRaw = byColumn('date').trim();
		if (!dateRaw) throw new Error('Date is required.');
		const date = parseIsoDateUtc(dateRaw);
		if (!date) throw new Error(`Invalid date "${dateRaw}".`);

		return {
			ok: true,
			record: {
				date,
				fee,
				feeCurrency,
				note: noteRaw ? noteRaw : null,
				price,
				priceCurrency: priceCurrencyRaw as Currency,
				quantity,
				side: sideRaw,
				symbol
			}
		};
	} catch (error) {
		return { message: error instanceof Error ? error.message : 'Unknown parsing error', ok: false };
	}
}

/** Watchlist read + per-new-symbol Yahoo pre-check (bounded). Returns the definitively-unknown set. */
export async function resolveUnknownSymbols(userId: string, distinctSymbols: string[]): Promise<Set<string>> {
	const valid = distinctSymbols.map(normalizeSymbol).filter((s) => s && isValidSymbolFormat(s));
	const distinct = Array.from(new Set(valid));
	const trackedRows = distinct.length
		? await db.watchlistItem.findMany({ select: { symbol: true }, where: { symbol: { in: distinct }, userId } })
		: [];
	const tracked = new Set(trackedRows.map((r) => r.symbol));
	const newSymbols = distinct.filter((s) => !tracked.has(s));
	if (newSymbols.length > CSV_NEW_SYMBOL_LIMIT) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `This file has ${newSymbols.length} new symbols to verify (max ${CSV_NEW_SYMBOL_LIMIT}). Please split it into smaller files, or add these symbols to your watchlist first.`
		});
	}
	const unknown = new Set<string>();
	for (const s of newSymbols) {
		// Only a definitive "reached Yahoo, no match" ('no') blocks the row; an 'unreachable'
		// result is given the benefit of the doubt so a Yahoo blip doesn't reject valid symbols.
		if ((await symbolExistsOnYahoo(s)) === 'no') unknown.add(s);
		await sleep(150);
	}
	return unknown;
}

export type ExistingRow = {
	id: string;
	date: string;
	fee: number | null;
	feeCurrency: Currency | null;
	note: string | null;
	price: number;
	priceCurrency: Currency;
	quantity: number;
	side: 'BUY' | 'SELL';
	symbol: string;
};

export type Classified = { record: CanonicalRecord; isDuplicate: boolean; existing: ExistingRow[] };

/**
 * `incoming` intentionally omits `id` — the incoming row is not a persisted transaction and
 * importCsv has never surfaced an id on it. Kept exact to preserve byte-identical output.
 */
export type DuplicateDescriptor = { id: string; incoming: Omit<ExistingRow, 'id'>; existing: ExistingRow[] };

/** Existing-row read + dedup classification, extracted from importCsv. */
export async function detectDuplicates(
	userId: string,
	records: CanonicalRecord[]
): Promise<{ classified: Classified[]; toInsert: CanonicalRecord[]; duplicates: DuplicateDescriptor[] }> {
	const symbolsInUpload = Array.from(new Set(records.map((r) => r.symbol)));
	const existing = symbolsInUpload.length
		? await db.transaction.findMany({
				select: {
					date: true,
					fee: true,
					feeCurrency: true,
					id: true,
					note: true,
					price: true,
					priceCurrency: true,
					quantity: true,
					side: true,
					symbol: true
				},
				where: {
					symbol: { in: symbolsInUpload },
					userId
				}
			})
		: [];
	const existingByKey = new Map<string, typeof existing>();
	for (const row of existing) {
		const key = makeDuplicateKey({
			date: row.date,
			fee: row.fee ?? null,
			feeCurrency: (row.feeCurrency ?? null) as Currency | null,
			note: row.note ?? null,
			price: row.price,
			priceCurrency: row.priceCurrency as Currency,
			quantity: row.quantity,
			side: row.side,
			symbol: row.symbol
		});
		const list = existingByKey.get(key);
		if (list) {
			list.push(row);
		} else {
			existingByKey.set(key, [row]);
		}
	}

	const classified: Classified[] = [];
	const duplicates: DuplicateDescriptor[] = [];
	const toInsert: CanonicalRecord[] = [];
	const duplicateCounts = new Map<string, number>();
	for (const record of records) {
		const key = makeDuplicateKey(record);
		const matches = existingByKey.get(key);
		if (matches && matches.length > 0) {
			const indexForKey = duplicateCounts.get(key) ?? 0;
			duplicateCounts.set(key, indexForKey + 1);
			const normalizedFeeCurrency = normalizeFeeCurrencyValue(
				record.fee,
				record.feeCurrency,
				record.priceCurrency
			);
			const existingRows: ExistingRow[] = matches.map((row) => ({
				date: toDateOnlyISOString(row.date),
				fee: row.fee ?? null,
				feeCurrency: normalizeFeeCurrencyValue(
					row.fee ?? null,
					(row.feeCurrency ?? null) as Currency | null,
					row.priceCurrency as Currency
				),
				id: row.id,
				note: row.note ?? null,
				price: row.price,
				priceCurrency: row.priceCurrency as Currency,
				quantity: row.quantity,
				side: row.side,
				symbol: row.symbol
			}));
			const incoming: Omit<ExistingRow, 'id'> = {
				date: toDateOnlyISOString(record.date),
				fee: record.fee,
				feeCurrency: normalizedFeeCurrency,
				note: record.note,
				price: record.price,
				priceCurrency: record.priceCurrency,
				quantity: record.quantity,
				side: record.side,
				symbol: record.symbol
			};
			duplicates.push({
				existing: existingRows,
				id: `${key}#${indexForKey}`,
				incoming
			});
			classified.push({ existing: existingRows, isDuplicate: true, record });
		} else {
			toInsert.push(record);
			classified.push({ existing: [], isDuplicate: false, record });
		}
	}

	return { classified, duplicates, toInsert };
}

/** The write, extracted from importCsv (lines 525–551). Tx-capable via `client`. */
export async function bulkCreateTransactions(
	userId: string,
	records: CanonicalRecord[],
	client: Pick<typeof db, 'transaction' | 'watchlistItem' | '$transaction'> = db
): Promise<{ imported: number }> {
	if (records.length === 0) return { imported: 0 };
	const uniqueSymbols = Array.from(new Set(records.map((r) => r.symbol)));
	await client.$transaction(async (trx) => {
		await trx.transaction.createMany({
			data: records.map((r) => ({
				date: r.date,
				fee: r.fee,
				feeCurrency: r.feeCurrency,
				note: r.note,
				price: r.price,
				priceCurrency: r.priceCurrency,
				quantity: r.quantity,
				side: r.side,
				symbol: r.symbol,
				userId
			}))
		});

		for (const symbol of uniqueSymbols) {
			await trx.watchlistItem.upsert({
				create: { symbol, userId },
				update: {},
				where: { userId_symbol: { symbol, userId } }
			});
		}
	});
	return { imported: records.length };
}

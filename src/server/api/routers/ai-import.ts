import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { mapColumns, SAMPLE_ROWS } from '@/server/ai/import/map-columns';
import { applyMapping, type ColumnMapping } from '@/server/ai/import/schema';
import { modelSelectorSchema } from '@/server/ai/model-selector-schema';
import { resolveModel } from '@/server/ai/resolve-model';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import {
	CANONICAL_HEADER,
	type CanonicalRecord,
	detectDuplicates,
	type ExistingRow,
	parseCsv,
	resolveUnknownSymbols,
	toDateOnlyISOString,
	validateRow
} from '@/server/services/transaction-import';

export type ReviewStatus = 'ok' | 'duplicate' | 'needs-fix';
export type ReviewValues = Record<(typeof CANONICAL_HEADER)[number], string>;
export type ReviewRow = {
	line: number;
	status: ReviewStatus;
	values: ReviewValues;
	message?: string;
	existing?: ExistingRow[];
};

const cellsToValues = (cells: string[]): ReviewValues => {
	const v = {} as ReviewValues;
	CANONICAL_HEADER.forEach((h, i) => {
		v[h] = cells[i] ?? '';
	});
	return v;
};
const recordToCells = (r: CanonicalRecord): string[] => [
	toDateOnlyISOString(r.date),
	r.symbol,
	r.side,
	String(r.quantity),
	String(r.price),
	r.priceCurrency,
	r.fee != null ? String(r.fee) : '',
	r.feeCurrency ?? '',
	r.note ?? ''
];

type MapFn = (rawHeader: string[], sampleRows: string[][]) => Promise<ColumnMapping>;

/** The full preview pipeline, with `map` injected so tests can supply a deterministic mapping. */
export async function previewImport(userId: string, csv: string, map: MapFn) {
	const rows = parseCsv(csv);
	if (rows.length < 2) throw new TRPCError({ code: 'BAD_REQUEST', message: 'File has no data rows.' });
	const [rawHeader, ...rawData] = rows;
	const data = rawData.filter((r) => !r.every((c) => c.trim() === ''));

	const mapping = await map(rawHeader ?? [], data.slice(0, SAMPLE_ROWS));
	for (const f of ['date', 'symbol', 'side', 'quantity', 'price'] as const) {
		if (mapping[f] == null) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: `Could not identify the "${f}" column in this file.` });
		}
	}

	const canonicalRows = applyMapping(data, mapping);
	const headerMap = new Map(CANONICAL_HEADER.map((h, i) => [h, i]));
	const distinct = canonicalRows.map((c) => c[headerMap.get('symbol')!] ?? '');
	const unknownSymbols = await resolveUnknownSymbols(userId, distinct);

	const built: Array<{ line: number; res: ReturnType<typeof validateRow>; cells: string[] }> = [];
	canonicalRows.forEach((cells, i) =>
		built.push({ cells, line: i + 2, res: validateRow(cells, headerMap, unknownSymbols) })
	);

	const valid = built.filter((b) => b.res.ok) as Array<{
		line: number;
		res: { ok: true; record: CanonicalRecord };
		cells: string[];
	}>;
	const { classified } = await detectDuplicates(
		userId,
		valid.map((v) => v.res.record)
	);
	const dupByIndex = new Map(classified.map((c, i) => [i, c]));

	const reviewRows: ReviewRow[] = [];
	let vi = 0;
	for (const b of built) {
		if (!b.res.ok) {
			reviewRows.push({
				line: b.line,
				message: b.res.message,
				status: 'needs-fix',
				values: cellsToValues(b.cells)
			});
			continue;
		}
		const c = dupByIndex.get(vi++);
		reviewRows.push({
			existing: c?.existing,
			line: b.line,
			status: c?.isDuplicate ? 'duplicate' : 'ok',
			values: cellsToValues(recordToCells(b.res.record))
		});
	}
	const stats = {
		duplicate: reviewRows.filter((r) => r.status === 'duplicate').length,
		needsFix: reviewRows.filter((r) => r.status === 'needs-fix').length,
		ok: reviewRows.filter((r) => r.status === 'ok').length,
		total: reviewRows.length
	};
	return { mapping, rows: reviewRows, stats };
}

export const aiImportRouter = createTRPCRouter({
	preview: protectedProcedure
		.input(z.object({ csv: z.string().min(1).max(1_000_000), model: modelSelectorSchema }))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			let resolved: Awaited<ReturnType<typeof resolveModel>>;
			try {
				// Unlike the chat route, this does NOT re-check `input.model.modelId` against the
				// credential's enabled set before calling resolveModel — a stale selection (a model
				// un-enabled after the picker loaded) silently falls back to defaultModelId instead of
				// being rejected. Acceptable here: the fallback only affects column mapping (never
				// user-facing content), and pricing still follows whatever model resolveModel actually
				// resolved to and ran, so there is no billing error — just possibly a different mapper
				// model than the one the user picked.
				resolved = await resolveModel(userId, input.model);
			} catch {
				throw new TRPCError({
					code: 'PRECONDITION_FAILED',
					message: 'No usable model for import. Configure a provider.'
				});
			}
			try {
				return await previewImport(userId, input.csv, (h, s) => mapColumns(resolved.model, h, s));
			} catch (err) {
				if (err instanceof TRPCError) throw err;
				// NEVER log `err` as an object or `input.csv`: an AI-SDK error can carry the request
				// body (the mapping prompt embeds the CSV header + sample rows). Log name+message only.
				console.error(
					'aiImport.preview failed:',
					err instanceof Error ? `${err.name}: ${err.message}` : String(err)
				);
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: "Couldn't read this statement. Please try again."
				});
			}
		})
});

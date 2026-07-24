'use client';

import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ReviewRowWithInclude } from './import-flow.helpers';

const FIELDS = ['date', 'symbol', 'side', 'quantity', 'price', 'priceCurrency', 'fee', 'feeCurrency', 'note'] as const;

const FIELD_LABEL: Record<(typeof FIELDS)[number], string> = {
	date: 'Date',
	fee: 'Fee',
	feeCurrency: 'Fee currency',
	note: 'Note',
	price: 'Price',
	priceCurrency: 'Price currency',
	quantity: 'Quantity',
	side: 'Side',
	symbol: 'Symbol'
};

const STATUS_LABEL: Record<ReviewRowWithInclude['status'], string> = {
	duplicate: 'Duplicate',
	'needs-fix': 'Needs fix',
	ok: 'Ready'
};

// Same color language as the classic CSV importer's duplicate-review dialog (amber for "review
// me"), extended with an emerald "ready" and a destructive "needs fix" state.
const STATUS_CLASS: Record<ReviewRowWithInclude['status'], string> = {
	duplicate: 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200',
	'needs-fix': 'border-destructive/40 bg-destructive/10 text-destructive',
	ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'
};

/**
 * One editable row per parsed CSV record: an "include in this import" checkbox (disabled for
 * `needs-fix` rows — they have nothing valid to import yet), a status chip tooltipped with the
 * server's per-row message, and a text input per canonical field so a flagged row can be
 * corrected without re-uploading the whole file. Fully controlled — every edit calls `onChange`
 * with a new array rather than holding local row state, so `ImportFlow` stays the single source
 * of truth for what gets sent to `bulkImport`.
 */
export function ReviewTable({
	onChange,
	rows
}: {
	onChange: (rows: ReviewRowWithInclude[]) => void;
	rows: ReviewRowWithInclude[];
}) {
	const update = (index: number, patch: Partial<ReviewRowWithInclude>) =>
		onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
	const setValue = (index: number, field: (typeof FIELDS)[number], value: string) =>
		update(index, { values: { ...rows[index]!.values, [field]: value } });

	return (
		<div className='overflow-x-auto rounded-md border'>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className='w-10' />
						<TableHead>Status</TableHead>
						{FIELDS.map((field) => (
							<TableHead key={field}>{FIELD_LABEL[field]}</TableHead>
						))}
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((row, index) => (
						<TableRow className='odd:bg-muted/30' key={row.line}>
							<TableCell>
								<Checkbox
									aria-label={`Include row ${row.line}`}
									checked={row.include}
									disabled={row.status === 'needs-fix'}
									onCheckedChange={(checked) => update(index, { include: checked === true })}
								/>
							</TableCell>
							<TableCell>
								<Badge className={STATUS_CLASS[row.status]} title={row.message ?? ''} variant='outline'>
									{STATUS_LABEL[row.status]}
								</Badge>
							</TableCell>
							{FIELDS.map((field) => (
								<TableCell key={field}>
									<Input
										aria-label={`${FIELD_LABEL[field]} row ${row.line}`}
										className='h-8 w-28'
										onChange={(e) => setValue(index, field, e.target.value)}
										value={row.values[field]}
									/>
								</TableCell>
							))}
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

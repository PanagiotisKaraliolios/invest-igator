'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { Currency } from '@/lib/currency';
import { formatCurrency as fx } from '@/lib/currency';
import { RowActions } from './row-actions';

export type TransactionRow = {
	id: string;
	date: string; // ISO date string
	symbol: string;
	side: 'BUY' | 'SELL';
	quantity: number;
	price: number; // per unit
	fee?: number | null;
	note?: string | null;
	priceCurrency: Currency;
	feeCurrency?: Currency | null;
};

function CurrencyCell({ value, currency }: { value: number; currency: Currency }) {
	return <span>{fx(value, currency)}</span>;
}

function formatDate(dateString: string): string {
	const date = new Date(dateString);
	return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

export const columns: ColumnDef<TransactionRow>[] = [
	{
		cell: ({ row }) => (
			<Checkbox
				aria-label='Select row'
				checked={row.getIsSelected()}
				onCheckedChange={(value) => row.toggleSelected(!!value)}
			/>
		),
		enableHiding: false,
		enableSorting: false,
		header: ({ table }) => (
			<Checkbox
				aria-label='Select all'
				checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')}
				onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
			/>
		),
		id: 'select',
		size: 24
	},
	{
		accessorKey: 'date',
		cell: ({ row }) => formatDate(row.original.date),
		header: ({ column }) => (
			<Button onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')} variant='ghost'>
				Date
				<ArrowUpDown className='ml-2 size-4' />
			</Button>
		),
		sortingFn: 'datetime'
	},
	{
		accessorKey: 'symbol',
		header: ({ column }) => (
			<Button onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')} variant='ghost'>
				Symbol
				<ArrowUpDown className='ml-2 size-4' />
			</Button>
		)
	},
	{
		accessorKey: 'side',
		cell: ({ getValue }) => {
			const side = String(getValue()) as TransactionRow['side'];
			const tone = side === 'BUY' ? 'default' : 'secondary';
			return <Badge variant={tone}>{side}</Badge>;
		},
		enableHiding: false,
		enableSorting: false,
		header: 'Side'
	},
	{
		accessorKey: 'quantity',
		header: ({ column }) => (
			<Button onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')} variant='ghost'>
				Qty
				<ArrowUpDown className='ml-2 size-4' />
			</Button>
		)
	},
	{
		accessorKey: 'price',
		cell: ({ row }) => <CurrencyCell currency={row.original.priceCurrency} value={Number(row.original.price)} />,
		header: ({ column }) => (
			<Button onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')} variant='ghost'>
				Price
				<ArrowUpDown className='ml-2 size-4' />
			</Button>
		)
	},
	{
		id: 'total',
		cell: ({ row }) => {
			const q = Number(row.original.quantity);
			const p = Number(row.original.price);
			const total = q * p; // exclude fee from total
			const isBuy = row.original.side === 'BUY';
			const sign = isBuy ? '- ' : '+ ';
			const cls = isBuy ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400';
			return (
				<span className={cls}>
					{sign}
					{fx(total, row.original.priceCurrency)}
				</span>
			);
		},
		enableSorting: false,
		header: 'Total'
	},
	{
		accessorKey: 'fee',
		cell: ({ row }) =>
			row.original.fee == null ? (
				<span className='text-muted-foreground'>—</span>
			) : (
				<CurrencyCell
					currency={(row.original.feeCurrency ?? row.original.priceCurrency) as Currency}
					value={Number(row.original.fee)}
				/>
			),
		enableSorting: false,
		header: 'Fee'
	},
	{
		accessorKey: 'note',
		enableSorting: false,
		header: 'Note'
	},
	{
		cell: ({ row }) => <RowActions row={row.original as any} />,
		enableHiding: false,
		enableSorting: false,
		id: 'actions'
	}
];

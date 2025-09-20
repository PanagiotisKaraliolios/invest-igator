'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
};

function formatCurrency(n: number): string {
	return new Intl.NumberFormat(undefined, { currency: 'USD', style: 'currency' }).format(n);
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
		cell: ({ getValue }) => {
			const d = new Date(String(getValue()));
			return <span>{d.toLocaleDateString()}</span>;
		},
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
		cell: ({ getValue }) => formatCurrency(Number(getValue())),
		header: ({ column }) => (
			<Button onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')} variant='ghost'>
				Price
				<ArrowUpDown className='ml-2 size-4' />
			</Button>
		)
	},
	{
		cell: ({ row }) => {
			const q = Number(row.original.quantity);
			const p = Number(row.original.price);
			const fee = Number(row.original.fee ?? 0);
			const signed = row.original.side === 'BUY' ? -1 : 1; // buys are cash outflows
			return formatCurrency(signed * (q * p - fee));
		},
		enableSorting: false,
		header: 'Total',
		id: 'total'
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
